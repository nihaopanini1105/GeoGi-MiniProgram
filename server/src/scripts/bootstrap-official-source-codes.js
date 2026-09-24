const { loadProductionEnv } = require('./production-env');
const { ensureOfficialDistributionSources } = require('../services/channel-store');
const { generateSourceMiniProgramCode } = require('../services/channel-service');

const DEFINITIONS = [
  ['website', 'official-website'],
  ['officialAccount', 'official-account'],
  ['liaoHuafengBusinessCard', 'business-card-liaohuafeng'],
  ['liShashaBusinessCard', 'business-card-lishasha']
];

async function main() {
  loadProductionEnv();
  const sources = await ensureOfficialDistributionSources();
  const results = {};
  for (const [key, alias] of DEFINITIONS) {
    const source = sources[key];
    if (!source || !source.sourceId) throw new Error('OFFICIAL_SOURCE_MISSING:' + key);
    results[key] = await generateSourceMiniProgramCode(source.sourceId, { alias });
  }
  console.log('OFFICIAL_SOURCE_CODES=READY');
  for (const [key, result] of Object.entries(results)) {
    console.log(
      'source_code_' + key + '=' + JSON.stringify({
        sourceId: result.sourceId,
        sourceName: result.sourceName,
        codeUrl: result.codeUrl,
        miniProgramPath: result.miniProgramPath
      })
    );
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('OFFICIAL_SOURCE_CODES=FAIL', error && error.message ? error.message : error);
    process.exit(1);
  });
}

module.exports = { main, DEFINITIONS };
