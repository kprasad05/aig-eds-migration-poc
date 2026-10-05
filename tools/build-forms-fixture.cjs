const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const columns = [
  'Name', 'Type', 'Label', 'Mandatory', 'Placeholder', 'Value', 'Action',
  'Required Error Message', 'Pattern Error Message', 'Max',
];
const fields = [
  ['firstName', 'text', 'First Name', 'true', 'First name', '', '', 'Please enter your first name.', '', '100'],
  ['lastName', 'text', 'Last Name', 'true', 'Last name', '', '', 'Please enter your last name.', '', '100'],
  ['email', 'email', 'Email', 'true', 'you@example.com', '', '', 'Please enter your email address.', 'Please enter a valid email address.', '254'],
  ['phone', 'tel', 'Phone Number', '', 'Phone number', '', '', '', '', '50'],
  ['company', 'text', 'Company', '', 'Company', '', '', '', '', '200'],
  ['subject', 'text', 'Subject', '', 'Subject', '', '', '', '', '200'],
  ['message', 'textarea', 'Message', 'true', 'How can we help?', '', '', 'Please enter a message.', '', '5000'],
  ['submit', 'submit', 'Submit', '', '', 'Thank you. Your message has been sent.', 'REPLACE_WITH_DESTINATION_SPREADSHEET_URL', '', '', ''],
];
const data = fields.map((values) => Object.fromEntries(
  columns.map((column, index) => [column, values[index]]),
));
const definition = {
  total: data.length,
  offset: 0,
  limit: data.length,
  columns,
  data,
  ':type': 'sheet',
};
const csvCell = (value) => (/[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);
const csv = [columns, ...fields].map((row) => row.map(csvCell).join(',')).join('\n');
fs.mkdirSync(path.join(root, 'docs/forms'), { recursive: true });
fs.writeFileSync(path.join(root, 'docs/forms/contact-us-definition.csv'), `${csv}\n`);
fs.writeFileSync(path.join(root, 'docs/forms/incoming.csv'), '__id__,firstName,lastName,email,phone,company,subject,message\n');
fs.writeFileSync(path.join(root, 'drafts/contact-us-definition.json'), `${JSON.stringify(definition, null, 2)}\n`);
