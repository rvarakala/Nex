import React, { useEffect, useState } from 'react';
import axios from 'axios';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * DeliveryChallanDoc — A4 presentational layout for an inter-clinic stock
 * transfer's delivery challan. Pure markup, fixed pixel dimensions tuned for
 * 96 DPI → 794 × 1123 px ≈ A4 portrait, so html2canvas → jsPDF produces a
 * clean print-ready page.
 *
 * Receiver signature is embedded inline as a blob URL (we fetch the GridFS
 * PNG once on mount).
 */
export default function DeliveryChallanDoc({ transfer }) {
  const t = transfer;
  const [sigUrl, setSigUrl] = useState(null);
  const [sealUrl, setSealUrl] = useState(null);

  useEffect(() => {
    let alive = true;
    let blobUrl = null;
    if (!t?.signature_image_fs_id) return;
    (async () => {
      try {
        const r = await axios.get(`${API}/stock-transfers/${t.transfer_id}/signature`, {
          responseType: 'blob',
        });
        if (!alive) return;
        blobUrl = URL.createObjectURL(r.data);
        setSigUrl(blobUrl);
      } catch { /* missing sig is not fatal — we just print a blank box */ }
    })();
    return () => { alive = false; if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [t]);

  // Receiver's seal — printed alongside their signature when they have one
  // on file AND have opted in to "challan" in their seal placement prefs.
  // The challan endpoint surfaces these as `received_by_seal_url` /
  // `received_by_seal_eligible` so we never call /auth/me from this doc
  // (which would be the WRONG user — the viewer, not the receiver).
  useEffect(() => {
    let alive = true;
    let blobUrl = null;
    const uid = t?.received_by_user_id;
    if (!uid || !t?.received_by_seal_eligible) return;
    (async () => {
      try {
        const r = await axios.get(`${API}/settings/users/${uid}/seal`, {
          responseType: 'blob',
        });
        if (!alive) return;
        blobUrl = URL.createObjectURL(r.data);
        setSealUrl(blobUrl);
      } catch { /* no seal on file → silently skip; signature stands alone */ }
    })();
    return () => { alive = false; if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [t]);

  const fmt = (iso) => iso ? new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }) : '—';

  return (
    <div
      data-testid="challan-doc"
      style={{
        width: '794px', minHeight: '1123px', padding: '40px 48px',
        background: '#fff', color: '#0F172A',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontSize: '12px', lineHeight: 1.45, boxSizing: 'border-box',
      }}
    >
      {/* Title strip */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        borderBottom: '3px solid #0F172A', paddingBottom: 12, marginBottom: 20,
      }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 1 }}>DELIVERY CHALLAN</div>
          <div style={{ fontSize: 10, color: '#64748B', marginTop: 4, letterSpacing: 0.5, textTransform: 'uppercase' }}>
            Inter-clinic stock transfer · {String(t.purpose || '').replace('_', ' ')}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{t.challan_no || '(unassigned)'}</div>
          <div style={{ fontSize: 10, color: '#64748B', marginTop: 2 }}>
            Date: <span style={{ fontWeight: 600 }}>{fmt(t.dispatched_at || t.created_at)}</span>
          </div>
          <div style={{
            display: 'inline-block', marginTop: 6, padding: '2px 8px', borderRadius: 3,
            fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
            background: t.status === 'received' ? '#DCFCE7' : t.status === 'dispatched' ? '#FEF3C7' : '#FEE2E2',
            color: t.status === 'received' ? '#166534' : t.status === 'dispatched' ? '#92400E' : '#991B1B',
          }}>
            {t.status === 'received' ? 'Delivered & Received' : t.status === 'dispatched' ? 'In Transit' : t.status}
          </div>
        </div>
      </div>

      {/* From / To grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        <ClinicBlock label="From (Consignor)" name={t.from_clinic_name} address={t.from_clinic_address} gstin={t.from_clinic_gstin} />
        <ClinicBlock label="To (Consignee)" name={t.to_clinic_name} address={t.to_clinic_address} gstin={t.to_clinic_gstin} />
      </div>

      {/* Items table */}
      <div style={{ marginBottom: 18 }}>
        <SectionLabel>Items dispatched ({(t.lines?.length || 0) + (t.accessory_lines?.length || 0)})</SectionLabel>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6, fontSize: 11 }}>
          <thead>
            <tr style={{ background: '#F1F5F9', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              <Th width="30">#</Th>
              <Th>Product</Th>
              <Th>Serial No.</Th>
              <Th width="55" align="right">Qty</Th>
            </tr>
          </thead>
          <tbody>
            {(t.lines || []).map((ln, i) => (
              <tr key={ln.serial_id} style={{ borderBottom: '1px solid #E2E8F0' }}>
                <Td>{i + 1}</Td>
                <Td><span style={{ fontWeight: 600 }}>{ln.product_label}</span></Td>
                <Td><span style={{ fontFamily: 'monospace' }}>{ln.serial_no}</span></Td>
                <Td align="right">{ln.qty}</Td>
              </tr>
            ))}
            {(t.accessory_lines || []).map((ln, i) => (
              <tr key={`acc-${i}`} style={{ borderBottom: '1px solid #E2E8F0' }}>
                <Td>{(t.lines?.length || 0) + i + 1}</Td>
                <Td><span style={{ fontWeight: 600 }}>{ln.product_label}</span> {ln.variant && <span style={{ color: '#64748B' }}>· {ln.variant}</span>}</Td>
                <Td>—</Td>
                <Td align="right">{ln.qty}</Td>
              </tr>
            ))}
          </tbody>
        </table>
        {/* Note: no GST tax breakdown — most HAs are GST-exempt; clinic-level GSTIN is printed in the From/To blocks. */}
        <div style={{ fontSize: 9, color: '#94A3B8', marginTop: 6, fontStyle: 'italic' }}>
          Stock movement only. No sale value transferred. Hearing aids are GST-exempt under Notification 02/2017 (Sl. 257).
        </div>
      </div>

      {/* Dispatch + Receive metadata */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        <MetaBlock title="Dispatched">
          <Row label="Date" value={fmt(t.dispatched_at)} />
          <Row label="Dispatched by" value={t.dispatched_by_name || '—'} />
          {t.courier_name && <Row label="Courier" value={t.courier_name} />}
          {t.tracking_no && <Row label="Tracking" value={<span style={{ fontFamily: 'monospace' }}>{t.tracking_no}</span>} />}
        </MetaBlock>
        <MetaBlock title="Received">
          {t.status === 'received' ? (
            <>
              <Row label="Date" value={fmt(t.received_at)} />
              <Row label="Received by" value={t.received_by_name} />
              <Row label="Role" value={String(t.received_by_role || '').replace('_', ' ')} />
              {t.short_shipment_notes && <Row label="Notes" value={t.short_shipment_notes} />}
            </>
          ) : (
            <div style={{ color: '#94A3B8', fontStyle: 'italic', fontSize: 11 }}>
              Pending receipt at destination clinic.
            </div>
          )}
        </MetaBlock>
      </div>

      {/* Notes */}
      {t.notes && (
        <div style={{
          background: '#F8FAFC', border: '1px solid #E2E8F0',
          borderRadius: 4, padding: '8px 10px', fontSize: 11, marginBottom: 24,
        }}>
          <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', color: '#64748B', marginBottom: 3 }}>
            Notes
          </div>
          {t.notes}
        </div>
      )}

      {/* Signature blocks */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 36, marginTop: 'auto', paddingTop: 28 }}>
        <SignBox
          label="For Consignor (Dispatched)"
          name={t.dispatched_by_name}
          subtitle={t.from_clinic_name}
        />
        <SignBox
          label="For Consignee (Received)"
          name={t.received_by_name}
          role={t.received_by_role}
          subtitle={t.to_clinic_name}
          signatureUrl={sigUrl}
          sealUrl={sealUrl}
        />
      </div>

      {/* Footer */}
      <div style={{
        marginTop: 36, paddingTop: 12, borderTop: '1px solid #CBD5E1',
        fontSize: 9, color: '#94A3B8', display: 'flex', justifyContent: 'space-between',
      }}>
        <span>Generated by AUDINEXA · {new Date().toLocaleString('en-IN')}</span>
        <span>Transfer ID: {t.transfer_id}</span>
      </div>
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================
const SectionLabel = ({ children }) => (
  <div style={{
    fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1,
    color: '#475569', borderBottom: '1px solid #CBD5E1', paddingBottom: 4,
  }}>
    {children}
  </div>
);

const ClinicBlock = ({ label, name, address, gstin }) => (
  <div>
    <SectionLabel>{label}</SectionLabel>
    <div style={{ marginTop: 6, fontSize: 12 }}>
      <div style={{ fontWeight: 700, fontSize: 13 }}>{name || '—'}</div>
      <div style={{ color: '#475569', marginTop: 2, lineHeight: 1.45 }}>{address || ''}</div>
      {gstin && (
        <div style={{ marginTop: 4, fontSize: 10 }}>
          <span style={{ color: '#94A3B8' }}>GSTIN:</span>{' '}
          <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{gstin}</span>
        </div>
      )}
    </div>
  </div>
);

const MetaBlock = ({ title, children }) => (
  <div>
    <SectionLabel>{title}</SectionLabel>
    <div style={{ marginTop: 6 }}>{children}</div>
  </div>
);

const Row = ({ label, value }) => (
  <div style={{ display: 'flex', fontSize: 11, marginBottom: 3 }}>
    <span style={{ color: '#94A3B8', width: 90, flexShrink: 0 }}>{label}</span>
    <span style={{ fontWeight: 500 }}>{value}</span>
  </div>
);

const Th = ({ children, width, align = 'left' }) => (
  <th style={{
    padding: '6px 10px', textAlign: align, fontWeight: 700, color: '#475569',
    width, borderBottom: '2px solid #CBD5E1',
  }}>{children}</th>
);

const Td = ({ children, align = 'left' }) => (
  <td style={{ padding: '7px 10px', textAlign: align, verticalAlign: 'top' }}>{children}</td>
);

const SignBox = ({ label, name, role, subtitle, signatureUrl, sealUrl }) => (
  <div>
    <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#64748B', marginBottom: 6 }}>
      {label}
    </div>
    <div style={{
      height: 70, borderBottom: '1px solid #0F172A', position: 'relative',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-start', paddingBottom: 2,
      gap: 12,
    }}>
      {signatureUrl && (
        <img
          src={signatureUrl}
          alt="signature"
          style={{ maxHeight: 60, maxWidth: '60%', objectFit: 'contain' }}
          data-testid="challan-signature-img"
        />
      )}
      {sealUrl && (
        <img
          src={sealUrl}
          alt="seal"
          style={{
            maxHeight: 64, maxWidth: '38%', objectFit: 'contain',
            // Subtle opacity mimics a physical wet-ink stamp impression so
            // the seal feels embossed rather than slapped over the signature.
            opacity: 0.86, marginLeft: 'auto', marginRight: 4,
          }}
          data-testid="challan-seal-img"
        />
      )}
    </div>
    <div style={{ marginTop: 4, fontSize: 11, fontWeight: 600 }}>{name || '—'}</div>
    {role && (
      <div style={{ fontSize: 10, color: '#64748B', textTransform: 'capitalize' }}>
        {String(role).replace('_', ' ')}
      </div>
    )}
    {subtitle && (
      <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 2 }}>{subtitle}</div>
    )}
  </div>
);
