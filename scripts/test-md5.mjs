// Quick MD5 verification script
// Usage: node scripts/test-md5.mjs

const crypto = await import('crypto');

// Reference values from Node's crypto
const refEmpty = crypto.createHash('md5').update('').digest('hex');
const refAbc = crypto.createHash('md5').update('abc').digest('hex');
const refTest = crypto.createHash('md5')
  .update('1700000000abc123def456{"email":"user@example.com","type":"register"}bf027fedb4d1b4f969c10495f12f17042bf0de02de128200')
  .digest('hex');

console.log('=== Node crypto reference ===');
console.log('MD5("")        =', refEmpty, '(expected: d41d8cd98f00b204e9800998ecf8427e)');
console.log('MD5("abc")     =', refAbc, '(expected: 900150983cd24fb0d6963f7d28e17f72)');
console.log('MD5(testSign)  =', refTest);
