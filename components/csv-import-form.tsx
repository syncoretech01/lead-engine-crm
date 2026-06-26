"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Upload } from "lucide-react";

type CsvImportFormProps = {
  profiles: Array<{ id: string; name: string }>;
};

type ImportResult = {
  jobId: string;
  replayed?: boolean;
  idempotencyKey?: string;
  queued?: boolean;
  raw: number;
  normalized: number;
  duplicates: number;
  suppressed: number;
  companies: number;
  contacts: number;
};

type CustomColumn = { column: string; fieldName: string };

export function CsvImportForm({ profiles }: CsvImportFormProps) {
  const router = useRouter();
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [customColumns, setCustomColumns] = useState<CustomColumn[]>([]);

  function addCustomColumn() {
    setCustomColumns((columns) => [...columns, { column: "", fieldName: "" }]);
  }

  function updateCustomColumn(index: number, key: keyof CustomColumn, value: string) {
    setCustomColumns((columns) => columns.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
  }

  function removeCustomColumn(index: number) {
    setCustomColumns((columns) => columns.filter((_, i) => i !== index));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);

    const response = await fetch("/api/import/csv", {
      method: "POST",
      body: new FormData(event.currentTarget)
    });

    const payload = await response.json();
    setLoading(false);

    if (!response.ok) {
      setError(payload.error ?? "CSV import failed.");
      return;
    }

    setResult(payload);
    event.currentTarget.reset();
    setCustomColumns([]);
    router.refresh();
  }

  return (
    <section className="panel" id="import-csv">
      <div className="panel-header">
        <div className="panel-title-wrap">
          <h2 className="section-title">CSV Upload And Field Mapping</h2>
          <p className="section-subtitle">Upload external leads, map fields, store raw rows, normalize, dedupe, and create CRM-ready records.</p>
        </div>
      </div>
      <form onSubmit={handleSubmit} className="panel-body form-grid" aria-busy={loading}>
        <div className="field">
          <label htmlFor="file">CSV file</label>
          <input id="file" name="file" type="file" accept=".csv,text/csv" required />
        </div>
        <div className="field">
          <label htmlFor="jobName">Lead job name</label>
          <input id="jobName" name="jobName" placeholder="June imported lead list" required />
        </div>
        <div className="field">
          <label htmlFor="source">Source label (fallback)</label>
          <input id="source" name="source" defaultValue="CSV Upload" required />
        </div>
        <div className="field">
          <label htmlFor="sourceColumn">Source column</label>
          <input id="sourceColumn" name="sourceColumn" placeholder="lead_source" />
        </div>
        <div className="field">
          <label htmlFor="searchProfileId">Search profile</label>
          <select id="searchProfileId" name="searchProfileId">
            <option value="">No profile</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="companyName">Company column</label>
          <input id="companyName" name="companyName" defaultValue="company" />
        </div>
        <div className="field">
          <label htmlFor="contactName">Contact column</label>
          <input id="contactName" name="contactName" defaultValue="contact" />
        </div>
        <div className="field">
          <label htmlFor="title">Title column</label>
          <input id="title" name="title" defaultValue="title" />
        </div>
        <div className="field">
          <label htmlFor="email">Email column</label>
          <input id="email" name="email" defaultValue="email" />
        </div>
        <div className="field">
          <label htmlFor="phone">Phone column</label>
          <input id="phone" name="phone" defaultValue="phone" />
        </div>
        <div className="field">
          <label htmlFor="domain">Domain column</label>
          <input id="domain" name="domain" defaultValue="domain" />
        </div>
        <div className="field">
          <label htmlFor="website">Website column</label>
          <input id="website" name="website" defaultValue="website" />
        </div>
        <div className="field">
          <label htmlFor="city">City column</label>
          <input id="city" name="city" defaultValue="city" />
        </div>
        <div className="field">
          <label htmlFor="state">State column</label>
          <input id="state" name="state" defaultValue="state" />
        </div>
        <div className="field">
          <label htmlFor="industry">Industry column</label>
          <input id="industry" name="industry" defaultValue="industry" />
        </div>
        <div className="field full">
          <label>Custom columns</label>
          <p className="field-note">
            Map any extra CSV column to a named custom field on the contact. Each becomes (or reuses) a contact custom field that shows on the contact record.
          </p>
          {customColumns.length > 0 ? (
            <div className="custom-columns">
              {customColumns.map((row, index) => (
                <div className="custom-column-row" key={index}>
                  <input
                    name="customColumnName"
                    placeholder="CSV column (e.g. linkedin_url)"
                    value={row.column}
                    onChange={(event) => updateCustomColumn(index, "column", event.target.value)}
                    aria-label={`Custom column ${index + 1} CSV header`}
                  />
                  <input
                    name="customColumnField"
                    placeholder="Field name (e.g. LinkedIn URL)"
                    value={row.fieldName}
                    onChange={(event) => updateCustomColumn(index, "fieldName", event.target.value)}
                    aria-label={`Custom column ${index + 1} field name`}
                  />
                  <button type="button" className="button subtle" onClick={() => removeCustomColumn(index)}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <button type="button" className="button subtle" onClick={addCustomColumn}>
            + Add custom column
          </button>
        </div>
        <div className="field">
          <label aria-hidden="true">&nbsp;</label>
          <button className="button primary" disabled={loading} type="submit">
            <Upload size={17} aria-hidden="true" />
            {loading ? "Uploading" : "Upload and queue"}
          </button>
        </div>
        {loading ? (
          <p className="section-subtitle info-text" aria-live="polite">
            Uploading the file, validating the mapping, and queueing background processing.
          </p>
        ) : null}
        {error ? (
          <p className="section-subtitle danger-text" aria-live="assertive" role="alert">
            {error}
          </p>
        ) : null}
        {result ? (
          <p className="section-subtitle success-text" aria-live="polite">
            {result.replayed
              ? `Reused job ${result.jobId}; this CSV import was already processed.`
              : result.queued
                ? `Queued ${result.raw} rows in job ${result.jobId}. The worker will normalize, verify, dedupe, and enrich it.`
              : `Imported ${result.raw} rows into job ${result.jobId}. Created ${result.companies} companies and ${result.contacts} contacts.`}
          </p>
        ) : null}
      </form>
    </section>
  );
}
