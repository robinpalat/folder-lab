
const fs = require('fs');
const path = require('path');

const promptsDir = path.join(__dirname, '../src/ai/prompts');
const domainsDir = path.join(promptsDir, 'domains');
const templatesDir = path.join(promptsDir, 'templates');
const generatedDir = path.join(promptsDir, 'generated');
const manifestPath = path.join(generatedDir, 'manifest.json');

// Asegurar que el directorio generated existe
if (!fs.existsSync(generatedDir)) {
  fs.mkdirSync(generatedDir, { recursive: true });
}

// ============================================================
// PARSER DE MARKDOWN (mismo que PromptBuilder.parseMarkdown)
// ============================================================

function parseMarkdown(content) {
  const systemMatch = content.match(/# System\s*\n([\s\S]*?)(?=# User|$)/);
  const userMatch = content.match(/# User\s*\n([\s\S]*?)$/);

  return {
    system: systemMatch ? systemMatch[1].trim() : '',
    user: userMatch ? userMatch[1].trim() : ''
  };
}

// ============================================================
// 1. CARGAR DOMINIOS
// ============================================================

const domains = {};
const domainFiles = fs.readdirSync(domainsDir).filter(f => f.endsWith('.json'));

for (const file of domainFiles) {
  const content = fs.readFileSync(path.join(domainsDir, file), 'utf8');
  const domain = JSON.parse(content);
  domains[domain.id] = domain;
  console.log(`✅ Dominio: ${domain.id} (${domain.capabilities.length} capacidades)`);
}

// ============================================================
// 2. CARGAR TEMPLATES
// ============================================================

const templates = {};
const templateFiles = fs.readdirSync(templatesDir).filter(f => f.endsWith('.md'));

for (const file of templateFiles) {
  const content = fs.readFileSync(path.join(templatesDir, file), 'utf8');
  const templateId = path.basename(file, '.md');
  
  templates[templateId] = parseMarkdown(content);
  console.log(`✅ Template: ${templateId}`);
}

// ============================================================
// 3. GENERAR MANIFIESTO
// ============================================================

const manifest = {
  domains,
  templates
};

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

console.log(`\n✅ Manifiesto generado en ${manifestPath}`);
console.log(`   - ${Object.keys(domains).length} dominios`);
console.log(`   - ${Object.keys(templates).length} templates`);
