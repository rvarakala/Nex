/**
 * Founder Dashboard — 30-Day Signup Funnel Card
 *
 * Different from the lifetime Conversion Funnel (Leads → Trials → Paid):
 * this one tracks *onboarding conversion* over the last 30 days —
 * Signups → Email-verified → Activated (created ≥1 patient).
 *
 * The two drop-off percentages are the founder's early-warning signals:
 *   - Low verify rate  → email delivery is silently broken (Zepto out of
 *                        credits, DNS mis-set, spam trap etc.)
 *   - Low activation   → users signed up + verified but didn't do the
 *                        first meaningful action — copy / onboarding fix
 */
import React from 'react';
import { AlertTriangle, CheckCircle2, ArrowRight, Zap } from 'lucide-react';

// Thresholds tuned for early-stage SaaS. Below these = actionable.
const VERIFY_HEALTHY   = 80;   // % of signups that finish verifying
const ACTIVATE_HEALTHY = 40;   // % of signups that create a patient

function Stage({ label, count, sublabel, tone = 'slate', testid }) {
  const tint = {
    slate:   'bg-slate-50 border-slate-200 text-slate-900',
    indigo:  'bg-indigo-50 border-indigo-200 text-indigo-900',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-900',
  }[tone];
  return (
    <div className={`rounded-xl border p-4 flex-1 min-w-[140px] ${tint}`} data-testid={testid}>
      <div className="text-[10px] uppercase tracking-wider font-semibold opacity-70">{label}</div>
      <div className="text-3xl font-extrabold mt-1 tabular-nums leading-none">{count}</div>
      {sublabel && <div className="text-[11px] mt-1.5 opacity-80">{sublabel}</div>}
    </div>
  );
}

function DropArrow({ pct, drop, warning, testid }) {
  const cls = warning
    ? 'text-rose-700 bg-rose-50 border-rose-200'
    : 'text-slate-700 bg-white border-slate-200';
  return (
    <div className={`hidden md:flex flex-col items-center justify-center px-2 shrink-0`} data-testid={testid}>
      <ArrowRight className={`w-5 h-5 mb-1 ${warning ? 'text-rose-500' : 'text-slate-400'}`} />
      <div className={`text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md border ${cls}`}>
        {pct}%
      </div>
      {drop > 0 && (
        <div className={`text-[10px] mt-1 ${warning ? 'text-rose-600 font-semibold' : 'text-slate-500'}`}>
          −{drop} drop
        </div>
      )}
    </div>
  );
}

export default function SignupFunnel({ data }) {
  if (!data) return null;
  const { signups, verified, activated,
          verify_rate_pct, activation_rate_pct, verified_to_activated_pct,
          signup_to_verify_drop, verify_to_activate_drop } = data;

  const verifyWarning   = signups >= 3 && verify_rate_pct   < VERIFY_HEALTHY;
  const activateWarning = verified >= 3 && verified_to_activated_pct < ACTIVATE_HEALTHY;
  const isHealthy = !verifyWarning && !activateWarning;

  // Insight line — the one thing the founder should read
  let insight;
  if (signups === 0) {
    insight = { tone: 'slate', text: 'No signups in the last 30 days. Fire up marketing 📣' };
  } else if (verifyWarning) {
    insight = { tone: 'rose', text: `Only ${verify_rate_pct}% of new signups verified their email — check the Email Health tab first.` };
  } else if (activateWarning) {
    insight = { tone: 'amber', text: `${verified_to_activated_pct}% of verified users created their first patient — onboarding may be too heavy.` };
  } else {
    insight = { tone: 'emerald', text: `Healthy funnel — ${verify_rate_pct}% verify, ${activation_rate_pct}% activate. Ship more copy like this.` };
  }
  const insightStyle = {
    slate:   'bg-slate-50 border-slate-200 text-slate-700',
    rose:    'bg-rose-50 border-rose-200 text-rose-800',
    amber:   'bg-amber-50 border-amber-200 text-amber-900',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  }[insight.tone];
  const InsightIcon = insight.tone === 'emerald' ? CheckCircle2
                    : insight.tone === 'slate'   ? Zap
                    : AlertTriangle;

  return (
    <div
      className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4"
      data-testid="signup-funnel-card"
      data-status={isHealthy ? 'healthy' : (verifyWarning ? 'critical' : 'degraded')}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-base font-bold text-slate-900">Signup Funnel · Last 30 days</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Signups → Email verified → Activated (created ≥1 patient)
          </p>
        </div>
      </div>

      {/* The three stages + drop-off arrows */}
      <div className="flex items-stretch gap-2 flex-wrap md:flex-nowrap">
        <Stage
          label="Signups"      count={signups}    sublabel="clinic accounts created"
          tone="slate"         testid="funnel-stage-signups"
        />
        <DropArrow  pct={verify_rate_pct}     drop={signup_to_verify_drop}
                    warning={verifyWarning}  testid="funnel-drop-verify" />
        <Stage
          label="Verified"     count={verified}   sublabel={`${verify_rate_pct}% of signups`}
          tone={verifyWarning ? 'slate' : 'indigo'} testid="funnel-stage-verified"
        />
        <DropArrow  pct={verified_to_activated_pct} drop={verify_to_activate_drop}
                    warning={activateWarning}   testid="funnel-drop-activate" />
        <Stage
          label="Activated"    count={activated}  sublabel={`${activation_rate_pct}% of signups`}
          tone={activateWarning ? 'slate' : 'emerald'} testid="funnel-stage-activated"
        />
      </div>

      {/* Founder insight line */}
      <div
        className={`rounded-lg border px-3 py-2.5 text-sm flex items-start gap-2 ${insightStyle}`}
        data-testid="funnel-insight"
      >
        <InsightIcon className="w-4 h-4 mt-0.5 shrink-0" />
        <span>{insight.text}</span>
      </div>
    </div>
  );
}
