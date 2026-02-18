const duckdb = require('duckdb');

const db = new duckdb.Database(':memory:');
const con = db.connect();

// Load spatial extension
con.run("LOAD spatial;");

// Query a sample
con.all(`
  SELECT * FROM read_parquet('/tmp/test_building.parquet') LIMIT 5
`, (err, rows) => {
  if (err) {
    console.error('Error:', err);
    return;
  }
  
  console.log('Columns:', Object.keys(rows[0]));
  console.log('\nFirst row:', JSON.stringify(rows[0], null, 2));
  
  // Check geometry_wkb type
  if (rows[0].geometry_wkb) {
    const geom = rows[0].geometry_wkb;
    console.log('\nGeometry type:', typeof geom);
    console.log('Is Buffer:', Buffer.isBuffer(geom));
    if (typeof geom === 'string') {
      console.log('String length:', geom.length);
      console.log('First 100 chars:', geom.substring(0, 100));
    } else if (Buffer.isBuffer(geom)) {
      console.log('Buffer length:', geom.length);
      console.log('Hex:', geom.toString('hex').substring(0, 100));
    } else if (geom && typeof geom === 'object') {
      console.log('Object keys:', Object.keys(geom));
    }
  }
});
