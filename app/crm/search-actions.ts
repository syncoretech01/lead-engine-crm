"use server";

import type { PrismaClient } from "@prisma/client";

import { getWorkspaceContext, getWorkspaceSessionContext } from "@/lib/phase1/store";
import { resolveStorageDriver } from "@/lib/phase1/storage-driver";
import { crmScopedContactIds } from "@/lib/phase1/crm-contacts-read-model";
import { restrictsToOwnedRecords } from "@/lib/phase1/auth";
import { ownedCrmRecordScope } from "@/lib/phase1/queries";
import { isPhoneSearchQuery, phoneMatchesSearch } from "@/lib/phone-search";

export type CrmSearchResults = {
  contacts: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    accountName: string | null;
  }[];
  companies: { id: string; name: string; domain: string | null }[];
  opportunities: { id: string; name: string; stage: string; companyId: string }[];
};

const EMPTY: CrmSearchResults = { contacts: [], companies: [], opportunities: [] };

/**
 * Command-palette record search across contacts / companies / opportunities.
 * SDR-scoped by reusing the same crmScopedContactIds path the lists use, so it
 * never surfaces a record the user can't otherwise see. Plain objects only.
 * Prisma-backed in production; falls back to the in-memory store in dev.
 */
export async function searchCrmRecordsAction(query: string): Promise<CrmSearchResults> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return EMPTY;

  if (resolveStorageDriver() === "prisma") {
    return searchViaPrisma(trimmed);
  }
  return searchViaState(trimmed);
}

async function searchViaPrisma(trimmed: string): Promise<CrmSearchResults> {
  const { session, workspaceId } = await getWorkspaceSessionContext("manage_crm");
  const { prisma } = await import("@/lib/prisma");
  const scoped = await crmScopedContactIds(session, workspaceId);
  const contains = { contains: trimmed, mode: "insensitive" as const };
  const contactScope = scoped ? { id: { in: scoped } } : {};
  const opportunityScope = scoped ? { contactId: { in: scoped } } : {};

  const [textContacts, phoneContacts, companies, opportunities] = await Promise.all([
    prisma.contact.findMany({
      where: { workspaceId, ...contactScope, OR: [{ fullName: contains }, { email: contains }] },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        company: { select: { name: true } }
      },
      take: 8
    }),
    isPhoneSearchQuery(trimmed)
      ? searchPrismaContactsByPhone(prisma, workspaceId, scoped, trimmed)
      : Promise.resolve([]),
    scoped
      ? Promise.resolve([])
      : prisma.company.findMany({
          where: { workspaceId, OR: [{ name: contains }, { rootDomain: contains }] },
          select: { id: true, name: true, rootDomain: true },
          take: 8
        }),
    prisma.opportunity.findMany({
      where: { workspaceId, ...opportunityScope, name: contains },
      select: { id: true, name: true, stage: true, accountId: true },
      take: 8
    })
  ]);

  const contacts = Array.from(
    new Map([...phoneContacts, ...textContacts].map((contact) => [contact.id, contact])).values()
  ).slice(0, 8);

  return {
    contacts: contacts.map((c) => ({
      id: c.id,
      name: c.fullName,
      email: c.email,
      phone: c.phone,
      accountName: c.company?.name ?? null
    })),
    companies: companies.map((c) => ({ id: c.id, name: c.name, domain: c.rootDomain })),
    opportunities: opportunities.map((o) => ({
      id: o.id,
      name: o.name,
      stage: String(o.stage),
      companyId: o.accountId
    }))
  };
}

async function searchViaState(trimmed: string): Promise<CrmSearchResults> {
  const { state, session, workspaceId } = await getWorkspaceContext("manage_crm");
  const needle = trimmed.toLowerCase();
  const scope = restrictsToOwnedRecords(session) ? ownedCrmRecordScope(state, session) : null;
  const inWorkspace = <T extends { workspaceId: string }>(row: T) => row.workspaceId === workspaceId;

  const contacts = state.contacts
    .filter(inWorkspace)
    .filter((contact) => !scope || scope.contactIds.has(contact.id))
    .filter(
      (contact) =>
        contact.name.toLowerCase().includes(needle) ||
        (contact.email ?? "").toLowerCase().includes(needle) ||
        phoneMatchesSearch(contact.phone, trimmed)
    )
    .slice(0, 8)
    .map((contact) => ({
      id: contact.id,
      name: contact.name,
      email: contact.email || null,
      phone: contact.phone || null,
      accountName:
        state.companies.find(
          (company) => company.id === contact.companyId && company.workspaceId === workspaceId
        )?.name ?? null
    }));

  const companies = scope
    ? []
    : state.companies
        .filter(inWorkspace)
        .filter(
          (company) =>
            company.name.toLowerCase().includes(needle) ||
            (company.domain ?? "").toLowerCase().includes(needle)
        )
        .slice(0, 8)
        .map((company) => ({ id: company.id, name: company.name, domain: company.domain || null }));

  const opportunities = state.opportunities
    .filter(inWorkspace)
    .filter((opportunity) => !scope || (opportunity.contactId ? scope.contactIds.has(opportunity.contactId) : false))
    .filter((opportunity) => opportunity.name.toLowerCase().includes(needle))
    .slice(0, 8)
    .map((opportunity) => ({
      id: opportunity.id,
      name: opportunity.name,
      stage: String(opportunity.stage),
      companyId: opportunity.companyId
    }));

  return { contacts, companies, opportunities };
}

type PhoneSearchContact = {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  company: { name: string } | null;
};

/**
 * Phone values predate a single display format, so a database `contains` query
 * cannot reliably compare them. Scan in bounded pages only for phone-like
 * queries and stop as soon as the palette has its eight results.
 */
async function searchPrismaContactsByPhone(
  prisma: PrismaClient,
  workspaceId: string,
  scopedContactIds: string[] | undefined,
  query: string
) {
  const matches: PhoneSearchContact[] = [];
  let cursor: string | undefined;
  const pageSize = 500;

  while (matches.length < 8) {
    const batch = await prisma.contact.findMany({
      where: {
        workspaceId,
        ...(scopedContactIds ? { id: { in: scopedContactIds } } : {}),
        phone: { not: null }
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        company: { select: { name: true } }
      },
      orderBy: { id: "asc" },
      take: pageSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
    });

    matches.push(...batch.filter((contact) => phoneMatchesSearch(contact.phone, query)));
    if (batch.length < pageSize) break;
    cursor = batch.at(-1)?.id;
    if (!cursor) break;
  }

  return matches.slice(0, 8);
}
