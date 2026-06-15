import {
  Bot,
  Brain,
  ClipboardCheck,
  Gauge,
  Lightbulb,
  MessageSquareText,
  PhoneCall,
  Sparkles,
  Target,
  TrendingUp
} from "lucide-react";
import {
  applyAiIcpRecommendationAction,
  applyAiLeadScoreAction,
  applyAiPersonalizationAction,
  classifyAiRepliesAction,
  createAiIcpRecommendationAction,
  dismissAiRecordAction,
  generateAiCallSummariesAction,
  generateAiDeliverabilityRecommendationsAction,
  generateAiIcpRecommendationsAction,
  generateAiLeadScoresAction,
  generateAiPersonalizationsAction,
  generateAiRevenueInsightsAction,
  runAiAutomationSuiteAction
} from "@/app/actions";
import { PageHeader } from "@/components/page-header";
import { StatusPill, statusTone } from "@/components/status-pill";
import { aiAutomationDashboard } from "@/lib/phase1/ai";
import { getDeveloperWorkspaceContext } from "@/lib/phase1/store";
import { formatCurrency, formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AutomationPage() {
  const { state, workspaceId } = await getDeveloperWorkspaceContext();
  const dashboard = aiAutomationDashboard(state, workspaceId);

  return (
    <>
      <PageHeader
        kicker="Phase 8"
        title="AI automation"
        copy="Local Syncore AI for personalization, reply intent, call summaries, predictive lead scoring, ICP recommendations, deliverability advice, and revenue insights."
        actions={
          <>
            <form action={runAiAutomationSuiteAction}>
              <button className="button primary" type="submit">
                <Sparkles size={17} aria-hidden="true" />
                Run suite
              </button>
            </form>
          </>
        }
      />

      <section className="grid metrics">
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Personalizations</span>
            <Lightbulb size={20} aria-hidden="true" />
          </div>
          <div className="metric-value gradient-text">{formatNumber(dashboard.metrics.personalizations)}</div>
          <span className="metric-note">First lines, angles, offers, and recommended channels.</span>
        </article>
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Reply classifications</span>
            <MessageSquareText size={20} aria-hidden="true" />
          </div>
          <div className="metric-value gradient-text">{formatNumber(dashboard.metrics.classifiedReplies)}</div>
          <span className="metric-note">Positive, negative, objection, OOO, unsubscribe, and neutral intent.</span>
        </article>
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">AI lead scores</span>
            <Brain size={20} aria-hidden="true" />
          </div>
          <div className="metric-value gradient-text">{formatNumber(dashboard.metrics.leadScorePredictions)}</div>
          <span className="metric-note">{formatNumber(dashboard.metrics.appliedRecords)} applied AI records.</span>
        </article>
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Revenue insights</span>
            <TrendingUp size={20} aria-hidden="true" />
          </div>
          <div className="metric-value gradient-text">{formatNumber(dashboard.metrics.revenueInsights)}</div>
          <span className="metric-note">Source, campaign, and SDR attribution signals.</span>
        </article>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div className="panel-title-wrap">
            <h2 className="section-title">Automation runners</h2>
            <p className="section-subtitle">Run each AI automation independently or refresh the full suite.</p>
          </div>
          <Bot size={20} aria-hidden="true" />
        </div>
        <div className="panel-body">
          <div className="chip-row">
            <form action={generateAiPersonalizationsAction}>
              <button className="button secondary" type="submit">Personalization</button>
            </form>
            <form action={classifyAiRepliesAction}>
              <button className="button secondary" type="submit">Reply classification</button>
            </form>
            <form action={generateAiCallSummariesAction}>
              <button className="button secondary" type="submit">Call summaries</button>
            </form>
            <form action={generateAiLeadScoresAction}>
              <button className="button secondary" type="submit">Lead scoring</button>
            </form>
            <form action={generateAiIcpRecommendationsAction}>
              <button className="button secondary" type="submit">ICP builder</button>
            </form>
            <form action={generateAiDeliverabilityRecommendationsAction}>
              <button className="button secondary" type="submit">Deliverability advisor</button>
            </form>
            <form action={generateAiRevenueInsightsAction}>
              <button className="button secondary" type="submit">Revenue insights</button>
            </form>
          </div>
        </div>
      </section>

      <section className="grid two">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">AI personalization</h2>
              <p className="section-subtitle">Contact-level first touch copy with campaign context and channel fit.</p>
            </div>
            <Lightbulb size={20} aria-hidden="true" />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Contact</th>
                  <th>First line</th>
                  <th>Angle</th>
                  <th>Channel</th>
                  <th>Confidence</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.personalizations.slice(0, 10).map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className="entity">
                        <strong>{item.contactName}</strong>
                        <span>{item.companyName}</span>
                        <span>{item.campaignName}</span>
                      </div>
                    </td>
                    <td>{item.firstLine}</td>
                    <td>{item.painPointAngle}</td>
                    <td>
                      <StatusPill label={item.recommendedChannel} tone="info" />
                    </td>
                    <td>{item.confidence}%</td>
                    <td>
                      <AiRecordActions
                        recordId={item.id}
                        recordType="ai_personalization"
                        applyName="personalizationId"
                        applyAction={applyAiPersonalizationAction}
                        status={item.status}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">AI lead scoring</h2>
              <p className="section-subtitle">Predictive fit, conversion probability, factors, risks, and CRM score application.</p>
            </div>
            <Brain size={20} aria-hidden="true" />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Contact</th>
                  <th>Score</th>
                  <th>Probability</th>
                  <th>Priority</th>
                  <th>Recommendation</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.leadScores.slice(0, 10).map((score) => (
                  <tr key={score.id}>
                    <td>
                      <div className="entity">
                        <strong>{score.contactName}</strong>
                        <span>{score.companyName}</span>
                        <span>{score.factors.slice(0, 2).join(" / ")}</span>
                      </div>
                    </td>
                    <td>{score.score}</td>
                    <td>{score.conversionProbability}%</td>
                    <td>
                      <span className={`grade ${score.priority.toLowerCase()}`}>{score.priority}</span>
                    </td>
                    <td>{score.recommendedAction}</td>
                    <td>
                      <AiRecordActions
                        recordId={score.id}
                        recordType="ai_lead_score"
                        applyName="predictionId"
                        applyAction={applyAiLeadScoreAction}
                        status={score.status}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="grid two">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">AI ICP builder</h2>
              <p className="section-subtitle">Closed-won analysis and prompt-generated target market recommendations.</p>
            </div>
            <Target size={20} aria-hidden="true" />
          </div>
          <form action={createAiIcpRecommendationAction} className="panel-body form-grid">
            <div className="field">
              <label htmlFor="prompt">ICP prompt</label>
              <textarea
                id="prompt"
                name="prompt"
                placeholder="Texas dealer owners with strong local reviews, direct phone numbers, and interest in lead quality"
              />
            </div>
            <div className="field">
              <label aria-hidden="true">&nbsp;</label>
              <button className="button primary" type="submit">
                <Sparkles size={17} aria-hidden="true" />
                Generate ICP
              </button>
            </div>
          </form>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Recommendation</th>
                  <th>Filters</th>
                  <th>Fit signals</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.icpRecommendations.slice(0, 8).map((icp) => (
                  <tr key={icp.id}>
                    <td>
                      <div className="entity">
                        <strong>{icp.name}</strong>
                        <span>{icp.sourceSummary}</span>
                        <span>{icp.confidence}% confidence</span>
                      </div>
                    </td>
                    <td>
                      <div className="chip-row">
                        {[...icp.industries, ...icp.titles, ...icp.geographies].slice(0, 6).map((value) => (
                          <span className="pill" key={value}>{value}</span>
                        ))}
                      </div>
                    </td>
                    <td>{icp.fitSignals.slice(0, 3).join(", ")}</td>
                    <td>
                      <StatusPill label={icp.status} tone={statusTone(icp.status)} />
                    </td>
                    <td>
                      <div className="chip-row">
                        {icp.status !== "Applied" ? (
                          <form action={applyAiIcpRecommendationAction}>
                            <input name="recommendationId" type="hidden" value={icp.id} />
                            <button className="button secondary" type="submit">Create profile</button>
                          </form>
                        ) : null}
                        <DismissButton recordId={icp.id} recordType="ai_icp_recommendation" status={icp.status} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Reply classification</h2>
              <p className="section-subtitle">Inbox and SMS replies classified into operational intent buckets.</p>
            </div>
            <MessageSquareText size={20} aria-hidden="true" />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Contact</th>
                  <th>Channel</th>
                  <th>Intent</th>
                  <th>Summary</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.replyClassifications.slice(0, 10).map((reply) => (
                  <tr key={reply.id}>
                    <td>
                      <div className="entity">
                        <strong>{reply.contactName}</strong>
                        <span>{reply.companyName}</span>
                      </div>
                    </td>
                    <td>{reply.channel}</td>
                    <td>
                      <StatusPill label={reply.intent} tone={statusTone(reply.intent)} />
                    </td>
                    <td>{reply.summary}</td>
                    <td>{reply.recommendedAction}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="grid two">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">AI call summaries</h2>
              <p className="section-subtitle">Call outcomes summarized with next steps, sentiment, objections, and topics.</p>
            </div>
            <PhoneCall size={20} aria-hidden="true" />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Call</th>
                  <th>Summary</th>
                  <th>Next steps</th>
                  <th>Sentiment</th>
                  <th>Topics</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.callSummaries.slice(0, 8).map((call) => (
                  <tr key={call.id}>
                    <td>
                      <div className="entity">
                        <strong>{call.contactName}</strong>
                        <span>{call.companyName}</span>
                        <span>{call.sdrName}</span>
                      </div>
                    </td>
                    <td>{call.summary}</td>
                    <td>{call.nextSteps.join(", ")}</td>
                    <td>
                      <StatusPill label={call.sentiment} tone={statusTone(call.sentiment)} />
                    </td>
                    <td>
                      <div className="chip-row">
                        {call.topics.map((topic) => (
                          <span className="pill" key={topic}>{topic}</span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Deliverability advisor</h2>
              <p className="section-subtitle">AI recommendations from bounce, spam, unsubscribe, authentication, and sending-limit signals.</p>
            </div>
            <Gauge size={20} aria-hidden="true" />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Issue</th>
                  <th>Severity</th>
                  <th>Metric</th>
                  <th>Recommendation</th>
                  <th>Impact</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.deliverabilityRecommendations.slice(0, 10).map((item) => (
                  <tr key={item.id}>
                    <td>{item.title}</td>
                    <td>
                      <StatusPill label={item.severity} tone={item.severity === "Critical" ? "danger" : item.severity === "Warning" ? "warning" : "info"} />
                    </td>
                    <td>{item.triggerMetric}</td>
                    <td>{item.recommendation}</td>
                    <td>{item.expectedImpact}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="grid two">
        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Revenue attribution insights</h2>
              <p className="section-subtitle">Best-performing source, campaign, and SDR dimensions with next actions.</p>
            </div>
            <TrendingUp size={20} aria-hidden="true" />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Dimension</th>
                  <th>Insight</th>
                  <th>Impact</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.revenueInsights.slice(0, 10).map((insight) => (
                  <tr key={insight.id}>
                    <td>
                      <div className="entity">
                        <strong>{insight.dimensionValue}</strong>
                        <span>{insight.dimension}</span>
                        <span>{insight.confidence}% confidence</span>
                      </div>
                    </td>
                    <td>{insight.insight}</td>
                    <td>{formatCurrency(insight.impactAmount)}</td>
                    <td>{insight.recommendedAction}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div className="panel-title-wrap">
              <h2 className="section-title">Automation run history</h2>
              <p className="section-subtitle">Phase 8 generation runs with records analyzed and created.</p>
            </div>
            <ClipboardCheck size={20} aria-hidden="true" />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Status</th>
                  <th>Analyzed</th>
                  <th>Created</th>
                  <th>Completed</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.automationRuns.slice(0, 14).map((run) => (
                  <tr key={run.id}>
                    <td>
                      <div className="entity">
                        <strong>{run.automationType}</strong>
                        <span>{run.summary}</span>
                      </div>
                    </td>
                    <td>
                      <StatusPill label={run.status} tone={statusTone(run.status)} />
                    </td>
                    <td>{formatNumber(run.recordsAnalyzed)}</td>
                    <td>{formatNumber(run.recordsCreated)}</td>
                    <td>{new Date(run.completedAt).toLocaleString("en-US")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}

type AiRecordActionsProps = {
  recordId: string;
  recordType: string;
  applyName: string;
  applyAction: (formData: FormData) => Promise<void>;
  status: string;
};

function AiRecordActions({ recordId, recordType, applyName, applyAction, status }: AiRecordActionsProps) {
  return (
    <div className="chip-row">
      {status !== "Applied" ? (
        <form action={applyAction}>
          <input name={applyName} type="hidden" value={recordId} />
          <button className="button secondary" type="submit">Apply</button>
        </form>
      ) : (
        <StatusPill label="Applied" tone="success" />
      )}
      <DismissButton recordId={recordId} recordType={recordType} status={status} />
    </div>
  );
}

function DismissButton({ recordId, recordType, status }: { recordId: string; recordType: string; status: string }) {
  if (status === "Dismissed") {
    return <StatusPill label="Dismissed" tone="warning" />;
  }

  return (
    <form action={dismissAiRecordAction}>
      <input name="recordId" type="hidden" value={recordId} />
      <input name="recordType" type="hidden" value={recordType} />
      <button className="button subtle" type="submit">Dismiss</button>
    </form>
  );
}
