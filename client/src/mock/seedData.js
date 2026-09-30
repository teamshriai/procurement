// Seed catalogue for Shri Health Procurement Centre.
// Item tuple: [name, unit, price, quantity, reorderLevel, gstRate, manufacturer]

export const suppliers = [
  { name: 'MedLife Pharma Distributors', contact_person: 'Rakesh Menon', phone: '+91 98450 11223', email: 'orders@medlifepharma.in', address: '12 Industrial Estate, Bengaluru', gst_number: '29AABCM1234F1Z5' },
  { name: 'Sanjeevani Pharma Wholesale', contact_person: 'Harish Kulkarni', phone: '+91 98860 45454', email: 'orders@sanjeevanipharma.in', address: 'Chickpet, Bengaluru', gst_number: '29AANCS3456U1Z5' },
  { name: 'Nirmal Medical Agencies', contact_person: 'Sneha Varghese', phone: '+91 94470 23232', email: 'sales@nirmalmedical.in', address: 'Broadway, Kochi', gst_number: '32AAOCN7890V1Z8' },
  { name: 'Arogya Drug House', contact_person: 'Venkat Raman', phone: '+91 94440 56780', email: 'supply@arogyadrughouse.in', address: 'Parrys Corner, Chennai', gst_number: '33AAPCA2468W1Z3' },
  { name: 'Lifeline Pharma Traders', contact_person: 'Meenal Desai', phone: '+91 98220 13579', email: 'orders@lifelinepharma.in', address: 'Kalbadevi Road, Mumbai', gst_number: '27AAQCL1357X1Z6' },
];

// Every department receives medicines from the Pharmacy (billing), but only the Pharmacy
// raises purchase requests to procurement. `groups` = what a department may request.
const MEDICINES = 'Pharmacy & Medicines';
export const departments = [
  { name: 'Pharmacy', head: 'Mr. Deepak Jain', location: 'Ground Floor, Block A', groups: [MEDICINES] },
  { name: 'Emergency & Trauma', head: 'Dr. Ravi Kumar', location: 'Ground Floor, Block A', groups: [] },
  { name: 'Intensive Care Unit (ICU)', head: 'Dr. Meera Das', location: '2nd Floor, Block A', groups: [] },
  { name: 'Operation Theatre', head: 'Dr. Sanjay Verma', location: '3rd Floor, Block B', groups: [] },
  { name: 'General Ward', head: 'Sr. Lakshmi Pillai', location: '1st Floor, Block C', groups: [] },
  { name: 'Paediatrics', head: 'Dr. Asha Menon', location: '2nd Floor, Block C', groups: [] },
  { name: 'Maternity & Gynaecology', head: 'Dr. Nandini Rao', location: '3rd Floor, Block C', groups: [] },
  { name: 'Outpatient Department (OPD)', head: 'Dr. Karthik S', location: 'Ground Floor, Block B', groups: [] },
];

// Groups -> subcategories -> items (medicines only)
export const catalogue = [
  {
    name: 'Pharmacy & Medicines', icon: 'pill', prefix: 'MED', supplier: 0, expiry: true,
    description: 'All drugs, injectables, fluids and pharmaceutical supplies',
    subs: [
      { name: 'Antibiotics', items: [
        ['Amoxicillin 500mg Capsules (10s)', 'strip', 85, 420, 100, 12, 'Cipla'],
        ['Azithromycin 500mg Tablets (3s)', 'strip', 118, 260, 80, 12, 'Alembic'],
        ['Ciprofloxacin 500mg Tablets (10s)', 'strip', 64, 310, 80, 12, 'Cipla'],
        ['Ceftriaxone 1g Injection', 'vial', 58, 540, 150, 12, 'Lupin'],
        ['Metronidazole 400mg Tablets (15s)', 'strip', 32, 45, 60, 12, 'Abbott'],
        ['Amoxicillin + Clavulanate 625mg (10s)', 'strip', 210, 180, 60, 12, 'GSK'],
        ['Doxycycline 100mg Capsules (10s)', 'strip', 72, 150, 50, 12, 'Sun Pharma'],
        ['Piperacillin + Tazobactam 4.5g Inj', 'vial', 390, 95, 40, 12, 'Pfizer'],
      ]},
      { name: 'Analgesics & Antipyretics', items: [
        ['Paracetamol 500mg Tablets (10s)', 'strip', 18, 1200, 300, 12, 'GSK'],
        ['Paracetamol 650mg Tablets (15s)', 'strip', 32, 860, 250, 12, 'Micro Labs'],
        ['Ibuprofen 400mg Tablets (10s)', 'strip', 26, 540, 150, 12, 'Abbott'],
        ['Diclofenac Sodium 75mg Injection', 'ampoule', 12, 380, 100, 12, 'Novartis'],
        ['Tramadol 50mg Capsules (10s)', 'strip', 55, 120, 40, 12, 'Intas'],
        ['Paracetamol IV Infusion 1g/100ml', 'bottle', 145, 30, 50, 12, 'Fresenius Kabi'],
      ]},
      { name: 'Cardiac & Blood Pressure', items: [
        ['Amlodipine 5mg Tablets (15s)', 'strip', 38, 480, 120, 12, 'Cipla'],
        ['Atorvastatin 10mg Tablets (15s)', 'strip', 96, 350, 100, 12, 'Ranbaxy'],
        ['Aspirin 75mg Tablets (14s)', 'strip', 22, 600, 150, 12, 'Bayer'],
        ['Metoprolol 50mg Tablets (10s)', 'strip', 48, 290, 80, 12, 'AstraZeneca'],
        ['Clopidogrel 75mg Tablets (15s)', 'strip', 105, 210, 60, 12, 'Sun Pharma'],
        ['Enoxaparin 40mg Pre-filled Syringe', 'syringe', 320, 70, 30, 12, 'Sanofi'],
      ]},
      { name: 'Diabetes Care', items: [
        ['Metformin 500mg Tablets (20s)', 'strip', 28, 720, 200, 12, 'USV'],
        ['Glimepiride 2mg Tablets (15s)', 'strip', 64, 260, 80, 12, 'Sanofi'],
        ['Human Insulin 40IU/ml 10ml', 'vial', 165, 85, 40, 5, 'Novo Nordisk'],
        ['Insulin Glargine 100IU Pen', 'pen', 780, 22, 25, 5, 'Sanofi'],
      ]},
      { name: 'Gastro & Antacids', items: [
        ['Pantoprazole 40mg Tablets (15s)', 'strip', 92, 520, 150, 12, 'Alkem'],
        ['Pantoprazole 40mg Injection', 'vial', 48, 260, 80, 12, 'Alkem'],
        ['Ondansetron 4mg Injection', 'ampoule', 14, 330, 100, 12, 'Cipla'],
        ['ORS Sachet 21.8g', 'sachet', 21, 900, 200, 12, 'FDC'],
        ['Domperidone 10mg Tablets (10s)', 'strip', 35, 240, 60, 12, 'Torrent'],
      ]},
      { name: 'Respiratory', items: [
        ['Salbutamol Inhaler 100mcg', 'inhaler', 145, 120, 40, 12, 'Cipla'],
        ['Budesonide Respules 0.5mg', 'respule', 28, 400, 100, 12, 'Cipla'],
        ['Montelukast 10mg Tablets (10s)', 'strip', 125, 180, 50, 12, 'Sun Pharma'],
        ['Cough Syrup 100ml', 'bottle', 98, 35, 50, 12, 'Dabur'],
      ]},
      { name: 'IV Fluids', items: [
        ['Normal Saline 0.9% 500ml', 'bottle', 32, 1400, 400, 12, 'Baxter'],
        ['Dextrose 5% 500ml', 'bottle', 34, 850, 250, 12, 'Baxter'],
        ["Ringer's Lactate 500ml", 'bottle', 38, 780, 250, 12, 'B. Braun'],
        ['DNS (Dextrose Normal Saline) 500ml', 'bottle', 36, 600, 200, 12, 'Fresenius Kabi'],
        ['Mannitol 20% 100ml', 'bottle', 88, 60, 30, 12, 'Baxter'],
      ]},
      { name: 'Emergency & Critical Drugs', items: [
        ['Adrenaline 1mg/ml Injection', 'ampoule', 22, 180, 60, 12, 'Neon Labs'],
        ['Atropine 0.6mg Injection', 'ampoule', 9, 210, 60, 12, 'Neon Labs'],
        ['Dexamethasone 4mg Injection', 'ampoule', 11, 420, 100, 12, 'Zydus'],
        ['Hydrocortisone 100mg Injection', 'vial', 42, 150, 50, 12, 'Pfizer'],
        ['Midazolam 5mg/ml Injection', 'ampoule', 36, 18, 30, 12, 'Neon Labs'],
        ['Furosemide 20mg Injection', 'ampoule', 8, 260, 80, 12, 'Sanofi'],
      ]},
      { name: 'Vitamins & Supplements', items: [
        ['Multivitamin Tablets (15s)', 'strip', 58, 340, 80, 12, 'Abbott'],
        ['Vitamin D3 60000IU Capsules (4s)', 'strip', 120, 220, 60, 12, 'Mankind'],
        ['Iron + Folic Acid Tablets (30s)', 'strip', 42, 480, 120, 12, 'Emcure'],
        ['Calcium + Vitamin D3 Tablets (15s)', 'strip', 95, 260, 80, 12, 'Torrent'],
      ]},
      { name: 'Antiseptics & Topicals', items: [
        ['Povidone Iodine 10% Solution 500ml', 'bottle', 245, 140, 40, 12, 'Win-Medicare'],
        ['Silver Sulfadiazine Cream 500g', 'jar', 390, 25, 15, 12, 'Mylan'],
        ['Mupirocin Ointment 5g', 'tube', 110, 160, 40, 12, 'GSK'],
        ['Chlorhexidine Mouthwash 150ml', 'bottle', 115, 90, 30, 12, 'ICPA'],
      ]},
      { name: 'Antifungals & Antivirals', items: [
        ['Fluconazole 150mg Tablets (1s)', 'strip', 22, 300, 80, 12, 'Cipla'],
        ['Acyclovir 400mg Tablets (10s)', 'strip', 96, 140, 40, 12, 'GSK'],
        ['Oseltamivir 75mg Capsules (10s)', 'strip', 480, 28, 30, 12, 'Cipla'],
        ['Clotrimazole Cream 1% 15g', 'tube', 58, 190, 50, 12, 'Glenmark'],
      ]},
      { name: 'Neuro & Psychiatric', items: [
        ['Phenytoin 100mg Tablets (10s)', 'strip', 18, 260, 80, 12, 'Abbott'],
        ['Levetiracetam 500mg Tablets (10s)', 'strip', 145, 150, 50, 12, 'UCB'],
        ['Diazepam 5mg Tablets (10s)', 'strip', 16, 40, 40, 12, 'Ranbaxy'],
        ['Haloperidol 5mg/ml Injection', 'ampoule', 14, 90, 30, 12, 'Sun Pharma'],
      ]},
      { name: 'Anaesthesia', items: [
        ['Lignocaine 2% Injection 30ml', 'vial', 32, 240, 80, 12, 'Neon Labs'],
        ['Bupivacaine 0.5% Heavy 4ml', 'ampoule', 45, 120, 40, 12, 'Neon Labs'],
        ['Propofol 1% 20ml Injection', 'vial', 165, 34, 40, 12, 'Fresenius Kabi'],
        ['Ketamine 50mg/ml 10ml Injection', 'vial', 110, 60, 20, 12, 'Neon Labs'],
      ]},
    ],
  },
];
