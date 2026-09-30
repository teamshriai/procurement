import { money } from '../utils';

/** Vendor dropdown options: usual vendor first, then past vendors with their last price, then everyone else. */
export function vendorOptions(line, suppliers) {
  const hist = new Map(line.vendors.map((v) => [v.supplier_id, v]));
  const cheapest = line.vendors.length > 1 ? Math.min(...line.vendors.map((v) => v.last_cost)) : null;
  const label = (s) => {
    const h = hist.get(s.id);
    const bits = [];
    if (s.id === line.default_supplier_id) bits.push('usual');
    if (h) bits.push(`last ${money(h.last_cost)}${h.last_cost === cheapest ? ', lowest' : ''}`);
    return bits.length ? `${s.name} (${bits.join(' · ')})` : s.name;
  };
  const known = suppliers.filter((s) => s.id === line.default_supplier_id || hist.has(s.id))
    .sort((a, b) => (b.id === line.default_supplier_id) - (a.id === line.default_supplier_id));
  const others = suppliers.filter((s) => !known.includes(s));
  return { known: known.map((s) => [s.id, label(s)]), others: others.map((s) => [s.id, s.name]) };
}

export function VendorSelect({ line, suppliers, value, onChange, allowSkip }) {
  const { known, others } = vendorOptions(line, suppliers);
  return (
    <select className="vendor-select" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{allowSkip ? 'Skip for now' : 'Choose vendor…'}</option>
      {known.length > 0 && <optgroup label="Suggested">{known.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</optgroup>}
      <optgroup label="Other vendors">{others.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</optgroup>
    </select>
  );
}

/** Old price = what this vendor charged last time, else the catalogue price. */
export const oldPrice = (line, supplierId) =>
  line.vendors.find((v) => v.supplier_id === Number(supplierId))?.last_cost ?? line.price;

/**
 * New price the procurement team decides on. Empty means "not decided yet":
 * press "Same price" to keep the old price, or type the new market price.
 */
export function NewPrice({ old, value, onChange }) {
  const decided = value !== '' && value !== null && value !== undefined;
  const n = Number(value);
  const pct = decided && old ? ((n - old) / old) * 100 : 0;
  let tag = null;
  if (decided) {
    if (Math.abs(pct) < 0.05) tag = <span className="price-tag same">Same</span>;
    else tag = <span className={`price-tag ${pct > 0 ? 'up' : 'down'}`}>{pct > 0 ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%</span>;
  }
  return (
    <div className={`new-price ${decided ? '' : 'undecided'}`}>
      <input
        className="input-num" type="number" min="0" step="0.01" placeholder="New price"
        value={value} onChange={(e) => onChange(e.target.value)} aria-label="New price"
      />
      {decided ? tag : (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(String(old))}>Same price</button>
      )}
    </div>
  );
}

export const priceDecided = (v) => v !== '' && v !== null && v !== undefined && Number(v) >= 0;
