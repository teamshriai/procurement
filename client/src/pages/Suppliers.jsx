import CrudPage from '../components/CrudPage';

export default function Suppliers() {
  return (
    <CrudPage
      endpoint="/suppliers"
      title="Vendors"
      singular="Vendor"
      deleteWarning="Items and orders linked to this vendor will be kept, without a vendor."
      fields={[
        { key: 'name', label: 'Vendor name', required: true, span: 2 },
        { key: 'contact_person', label: 'Contact person' },
        { key: 'phone', label: 'Phone' },
        { key: 'email', label: 'Email', type: 'email' },
        { key: 'gst_number', label: 'GSTIN' },
        { key: 'address', label: 'Address', type: 'textarea', span: 2 },
      ]}
      columns={[
        { label: 'Vendor', render: (r) => <><div className="cell-title">{r.name}</div><div className="muted small">{r.address}</div></> },
        { label: 'Contact', render: (r) => <><div>{r.contact_person || '—'}</div><div className="muted small">{r.phone}</div></> },
        { label: 'Email', render: (r) => (r.email ? <a href={`mailto:${r.email}`}>{r.email}</a> : '—') },
        { label: 'GSTIN', className: 'mono small', render: (r) => r.gst_number || '—' },
        { label: 'Items', className: 'num', render: (r) => r.item_count },
        { label: 'Orders', className: 'num', render: (r) => r.po_count },
      ]}
    />
  );
}
