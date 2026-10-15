import { salaryFor } from '../src/mcp/answers.js';

const profile = {
  salary: { amount: 600000, currency: 'PKR', period: 'month' },
  currentSalary: { amount: 500000, currency: 'PKR', period: 'month' },
  salaryExpectations: [
    { country: 'Pakistan', min: 600000, max: 800000, currency: 'PKR', period: 'month' },
    { country: 'Worldwide', min: 5000, max: 5000, currency: 'USD', period: 'month' },
  ],
  answers: {},
};

let fail = 0;
const check = (name, actual, expected) => {
  const ok = actual === expected;
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}: ${actual}`);
  if (!ok) fail++;
};

check('current salary stays separate', salaryFor('What is your current salary in PKR?', profile), '500000');
check('Pakistan returns a range', salaryFor('What is your expected monthly salary in Pakistan?', profile), '600000-800000');
check('worldwide USD expectation is selected', salaryFor('What is your expected salary in USD per month?', profile), '5000');
check('annual conversion preserves the range', salaryFor('What is your expected annual salary in Pakistan?', profile), '7200000-9600000');
check('numeric fields use the lower bound', salaryFor('Expected salary PKR', profile, true), '600000');
check('SAR current salary converts from PKR', salaryFor('What is your current monthly salary in SAR?', profile), '6700');
check('SAR expected salary converts the PKR range', salaryFor('What is your expected monthly salary in SAR?', profile), '8000-10700');

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
