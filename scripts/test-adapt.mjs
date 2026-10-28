import { adaptFieldsEnabled, adaptedField } from '../src/mcp/answers.js';

const karachi = { location: 'Karachi, Pakistan', country: 'Pakistan', preferences: { adaptFields: true } };
const off = { ...karachi, preferences: { adaptFields: false } };
const missing = { location: 'Karachi, Pakistan', preferences: {} };
const lisbon = { location: 'Lisbon, Portugal', preferences: { adaptFields: true } };

let fail = 0;
const check = (name, value) => { console.log((value ? 'PASS' : 'FAIL') + ' - ' + name); if (!value) fail++; };

check('missing switch is off', adaptFieldsEnabled(missing) === false);
check('explicit off is off', adaptFieldsEnabled(off) === false);
check('explicit on is on', adaptFieldsEnabled(karachi));
check('karachi postal', adaptedField('Postal Code', karachi) === '75500');
check('zip code', adaptedField('Zip code', karachi) === '75500');
check('province', adaptedField('Province', karachi) === 'Sindh');
check('state', adaptedField('State', karachi) === 'Sindh');
check('lahore postal', adaptedField('Postcode', { location: 'Lahore', preferences: { adaptFields: true } }) === '54000');
check('off does not invent a postal code', adaptedField('Postal Code', off) == null);
check('missing key does not invent a postal code', adaptedField('Postal Code', missing) == null);
check('unknown city stays blank', adaptedField('Postal Code', lisbon) == null);
check('salary is not adapted', adaptedField('Desired salary', karachi) == null);
check('visa is not adapted', adaptedField('Do you need visa sponsorship?', karachi) == null);
check('long state sentence is not a province', adaptedField('Describe the state of your last production system in detail please', karachi) == null);

process.exit(fail ? 1 : 0);
