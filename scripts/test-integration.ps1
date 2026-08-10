$ErrorActionPreference = 'Stop'
$testUrl = if ($env:DATABASE_URL_TEST) { $env:DATABASE_URL_TEST } else { 'postgresql://izlk_test:izlk_test@127.0.0.1:5433/izlk_test' }
if ($testUrl -notmatch 'izlk_test') { throw 'DATABASE_URL_TEST must point to the isolated izlk_test database.' }
docker compose -f docker-compose.test.yml up -d --wait
if ($LASTEXITCODE -ne 0) { throw 'Test PostgreSQL container did not start.' }
$env:DATABASE_URL = $testUrl
npx.cmd prisma migrate deploy
if ($LASTEXITCODE -ne 0) { throw 'Migrations did not apply to the test database.' }
npx.cmd tsx scripts/test-integration.ts
if ($LASTEXITCODE -ne 0) { throw 'Integration scenario failed.' }
