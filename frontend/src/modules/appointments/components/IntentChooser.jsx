import React from 'react';
import { User, Building2, Briefcase, Wrench, Users, Pin, X } from 'lucide-react';

/**
 * IntentChooser — quick "what kind of appointment?" picker shown when the user
 * clicks "+ New Appointment". Six tiles map 1-to-1 to backend `counterparty_type`s.
 * The Patient tile is highlighted (it's the >90% case for clinics).
 */
const TILES = [
  { type: 'patient',    label: 'Patient',     hint: 'Clinical visit',          Icon: User,       featured: true },
  { type: 'vendor',     label: 'Vendor',      hint: 'Phonak, Signia…',         Icon: Building2 },
  { type: 'sales_rep',  label: 'Sales Rep',   hint: 'Brand visit',             Icon: Briefcase },
  { type: 'tech_staff', label: 'Tech Staff',  hint: 'Engineer / fitter',       Icon: Wrench },
  { type: 'internal',   label: 'Internal',    hint: 'Team meeting',            Icon: Users },
  { type: 'other',      label: 'Other',       hint: 'Anything else',           Icon: Pin },
];

export default function IntentChooser({ onPick, onClose }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      data-testid="apt-intent-chooser"
    >
      <div className="bg-white rounded-xl shadow-2xl w-[480px] max-w-full overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-[15px] font-bold text-slate-900">New appointment</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">Who is this slot with?</p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md flex items-center justify-center"
            data-testid="apt-intent-close"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="p-4 grid grid-cols-3 gap-2.5">
          {TILES.map(({ type, label, hint, Icon, featured }) => (
            <button
              key={type}
              type="button"
              onClick={() => onPick(type)}
              data-testid={`apt-intent-${type}`}
              className={`group flex flex-col items-start gap-1.5 p-3 rounded-lg border text-left transition-all ${
                featured
                  ? 'bg-blue-50 border-blue-200 hover:bg-blue-100 hover:border-blue-300'
                  : 'bg-white border-slate-200 hover:border-blue-300 hover:bg-blue-50/50'
              }`}
            >
              <div
                className={`w-8 h-8 rounded-md flex items-center justify-center ${
                  featured ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 group-hover:bg-blue-100 group-hover:text-blue-700'
                }`}
              >
                <Icon size={16} strokeWidth={2.2} />
              </div>
              <div className="text-[12px] font-bold text-slate-900">{label}</div>
              <div className="text-[10px] text-slate-500 leading-tight">{hint}</div>
            </button>
          ))}
        </div>
        <div className="px-5 py-2.5 bg-slate-50 border-t border-slate-100 text-[10px] text-slate-400 text-center">
          Tip: Right-click any time slot in the calendar to skip this step.
        </div>
      </div>
    </div>
  );
}
