const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const { Pool } = require('pg');
const analise = require('./lib/analise');
const cupom = require('./lib/cupom');
const { lerCupom, CATEGORIAS } = require('./lib/leitura');

const PORTA = process.env.PORT || 3000;
const SENHA = process.env.APP_SENHA;
const SEGREDO = process.env.SESSION_SECRET;
const PRODUCAO = process.env.NODE_ENV === 'production' || !!process.env.RENDER;

if (!SENHA || !SEGREDO) {
  console.error('Defina APP_SENHA e SESSION_SECRET nas variáveis de ambiente.');
  process.exit(1);
}

// Supabase exige SSL; o certificado do pooler não está na cadeia padrão do Node
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
  max: 5,
});

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));

// ---------- sessão (cookie assinado, sem tabela) ----------
const DIAS_SESSAO = 60;
const assinar = (v) => crypto.createHmac('sha256', SEGREDO).update(v).digest('base64url');

function lerCookie(req, nome) {
  const c = (req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(nome + '='));
  return c ? decodeURIComponent(c.slice(nome.length + 1)) : null;
}

function sessaoValida(req) {
  const v = lerCookie(req, 'sessao');
  if (!v) return false;
  const [exp, sig] = v.split('.');
  if (!exp || !sig) return false;
  const esperado = assinar(exp);
  if (sig.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(esperado))) return false;
  return Number(exp) > Date.now();
}

function gravarSessao(res) {
  const exp = String(Date.now() + DIAS_SESSAO * 86400000);
  res.setHeader('Set-Cookie',
    `sessao=${exp}.${assinar(exp)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DIAS_SESSAO * 86400}${PRODUCAO ? '; Secure' : ''}`);
}

// limite de tentativas de login: 8 a cada 15 min por IP
const tentativas = new Map();
function bloqueado(ip) {
  const agora = Date.now();
  const t = (tentativas.get(ip) || []).filter((x) => agora - x < 15 * 60000);
  tentativas.set(ip, t);
  return t.length >= 8;
}

app.post('/api/entrar', (req, res) => {
  if (bloqueado(req.ip)) return res.status(429).json({ erro: 'Muitas tentativas. Espere 15 minutos.' });
  const senha = String(req.body?.senha || '');
  const a = crypto.createHash('sha256').update(senha).digest();
  const b = crypto.createHash('sha256').update(SENHA).digest();
  if (!crypto.timingSafeEqual(a, b)) {
    tentativas.get(req.ip).push(Date.now());
    return res.status(401).json({ erro: 'Senha incorreta.' });
  }
  gravarSessao(res);
  res.json({ ok: true });
});

app.post('/api/sair', (req, res) => {
  res.setHeader('Set-Cookie', 'sessao=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/saude', (req, res) => res.json({ ok: true }));

app.use('/api', (req, res, next) => (sessaoValida(req) ? next() : res.status(401).json({ erro: 'Entre com a senha.' })));

app.get('/api/eu', (req, res) => res.json({ ok: true, categorias: CATEGORIAS, ia: !!process.env.ANTHROPIC_API_KEY }));

// ---------- leitura gratuita: texto do OCR do celular ou texto copiado da SEFAZ ----------
async function finalizarLeitura(nota) {
  const prods = await db.query('select codigo, descricao, categoria from mercado.produtos');
  cupom.corrigirComCadastro(nota, prods.rows);
  let duplicada = null;
  if (nota.chave) {
    const r = await db.query('select id, data from mercado.compras where chave = $1', [nota.chave]);
    duplicada = r.rows[0] || null;
  }
  return { nota, conferencia: analise.conferir(nota), duplicada };
}

app.post('/api/leitura-texto', async (req, res) => {
  const textos = (req.body?.textos || []).filter((t) => typeof t === 'string' && t.trim());
  if (!textos.length) return res.status(400).json({ erro: 'Não consegui ler texto nas fotos.' });
  const nota = cupom.montarNota(textos);
  if (req.body.chave) nota.chave = req.body.chave;
  if (!nota.itens.length) return res.status(422).json({ erro: 'Não achei itens nas fotos. Tente fotos mais nítidas, com o cupom esticado e bem iluminado.' });
  res.json(await finalizarLeitura(nota));
});

app.post('/api/leitura-sefaz', async (req, res) => {
  const texto = String(req.body?.texto || '');
  if (texto.trim().length < 30) return res.status(400).json({ erro: 'Cole o texto completo da página da nota.' });
  const nota = cupom.lerSefaz(texto, req.body.chave || null);
  if (!nota.itens.length) return res.status(422).json({ erro: 'Não achei itens no texto colado.' });
  res.json(await finalizarLeitura(nota));
});

// ---------- leitura do cupom ----------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 8, fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, f, cb) => cb(null, /^image\/(jpeg|png|webp)$/.test(f.mimetype)),
});

// leitura por IA (opcional, só com ANTHROPIC_API_KEY)
app.post('/api/leitura', upload.array('fotos', 8), async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ erro: 'Leitura por IA desligada (sem chave).' });
  if (!req.files?.length) return res.status(400).json({ erro: 'Envie pelo menos uma foto do cupom.' });
  try {
    const { nota, uso } = await lerCupom(req.files);
    let duplicada = null;
    if (nota.chave) {
      const r = await db.query('select id, data from mercado.compras where chave = $1', [nota.chave]);
      duplicada = r.rows[0] || null;
    }
    res.json({ nota, conferencia: analise.conferir(nota), duplicada, uso });
  } catch (e) {
    console.error('leitura', e);
    res.status(502).json({ erro: e.message || 'Não foi possível ler o cupom.' });
  }
});

// ---------- compras ----------
function codigoProduto(item) {
  const c = String(item.codigo || '').replace(/\D/g, '');
  // EAN tem 8+ dígitos; códigos internos (ex.: tomate "934") dependem da loja
  return c.length >= 8 ? c : `int:${c || item.descricao.trim().toUpperCase()}`;
}

app.post('/api/compras', async (req, res) => {
  const n = req.body?.nota;
  if (!n?.itens?.length || !n.data) return res.status(400).json({ erro: 'Nota sem itens ou sem data.' });
  const cli = await db.connect();
  try {
    await cli.query('begin');
    let lojaId = null;
    if (n.loja?.nome) {
      const r = n.loja.cnpj
        ? await cli.query(
          `insert into mercado.lojas (cnpj, nome, cidade) values ($1,$2,$3)
           on conflict (cnpj) do update set nome = excluded.nome returning id`,
          [n.loja.cnpj, n.loja.nome, n.loja.cidade])
        : await cli.query('insert into mercado.lojas (nome, cidade) values ($1,$2) returning id', [n.loja.nome, n.loja.cidade]);
      lojaId = r.rows[0].id;
    }
    const desconto = n.itens.reduce((s, i) => s + (Number(i.desconto) || 0), 0);
    const total = Number(n.total) || n.itens.reduce((s, i) => s + Number(i.valor_total), 0);
    const c = await cli.query(
      `insert into mercado.compras (loja_id, data, chave, numero, total, desconto_total, forma_pagamento)
       values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [lojaId, n.data, n.chave || null, n.numero || null, total, desconto, n.forma_pagamento || null]);
    const compraId = c.rows[0].id;

    for (const it of n.itens) {
      const codigo = codigoProduto(it);
      await cli.query(
        `insert into mercado.produtos (codigo, descricao, categoria, conteudo, conteudo_unid)
         values ($1,$2,$3,$4,$5)
         on conflict (codigo) do update set descricao = excluded.descricao`,
        [codigo, it.descricao, CATEGORIAS.includes(it.categoria) ? it.categoria : 'Outros', it.conteudo ?? null, it.conteudo_unid ?? null]);
      await cli.query(
        `insert into mercado.itens (compra_id, produto_codigo, descricao, quantidade, unidade, preco_unit, desconto, valor_total)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [compraId, codigo, it.descricao, Number(it.quantidade) || 1, it.unidade || null,
          Number(it.preco_unit) || 0, Number(it.desconto) || 0, Number(it.valor_total) || 0]);
    }
    await cli.query('commit');
    res.json({ ok: true, id: compraId });
  } catch (e) {
    await cli.query('rollback');
    if (e.code === '23505') return res.status(409).json({ erro: 'Esta nota já foi lançada.' });
    console.error('salvar compra', e);
    res.status(500).json({ erro: 'Não foi possível salvar a compra.' });
  } finally {
    cli.release();
  }
});

app.get('/api/compras', async (req, res) => {
  const r = await db.query(
    `select c.id, c.data, c.total, c.desconto_total, l.nome as loja,
            (select count(*) from mercado.itens i where i.compra_id = c.id)::int as itens
       from mercado.compras c left join mercado.lojas l on l.id = c.loja_id
      order by c.data desc limit 200`);
  res.json(r.rows);
});

app.get('/api/compras/:id', async (req, res) => {
  const c = await db.query(
    `select c.*, l.nome as loja from mercado.compras c left join mercado.lojas l on l.id = c.loja_id where c.id = $1`,
    [req.params.id]);
  if (!c.rows[0]) return res.status(404).json({ erro: 'Compra não encontrada.' });
  const i = await db.query(
    `select i.*, p.nome, p.categoria from mercado.itens i join mercado.produtos p on p.codigo = i.produto_codigo
      where i.compra_id = $1 order by i.id`, [req.params.id]);
  res.json({ ...c.rows[0], itens: i.rows });
});

app.delete('/api/compras/:id', async (req, res) => {
  await db.query('delete from mercado.compras where id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ---------- painel e produtos ----------
async function todosItens() {
  const r = await db.query(
    `select i.compra_id, c.data, i.produto_codigo, i.descricao, p.nome, p.categoria,
            i.quantidade, i.preco_unit, i.desconto, i.valor_total
       from mercado.itens i
       join mercado.compras c on c.id = i.compra_id
       join mercado.produtos p on p.codigo = i.produto_codigo
      order by c.data, i.id`);
  return r.rows;
}

app.get('/api/painel', async (req, res) => {
  const [itens, compras] = await Promise.all([
    todosItens(),
    db.query('select id, data, total from mercado.compras').then((r) => r.rows),
  ]);
  res.json(analise.painel(itens, compras));
});

app.get('/api/produtos/:codigo', async (req, res) => {
  const p = await db.query('select * from mercado.produtos where codigo = $1', [req.params.codigo]);
  if (!p.rows[0]) return res.status(404).json({ erro: 'Produto não encontrado.' });
  const itens = await todosItens();
  res.json({
    ...p.rows[0],
    historico: analise.historicoPreco(itens, req.params.codigo),
    consumo: analise.consumoMensal(itens, req.params.codigo),
  });
});

app.patch('/api/produtos/:codigo', async (req, res) => {
  const { nome, categoria } = req.body || {};
  if (categoria && !CATEGORIAS.includes(categoria)) return res.status(400).json({ erro: 'Categoria inválida.' });
  await db.query(
    `update mercado.produtos set nome = coalesce($2, nome), categoria = coalesce($3, categoria) where codigo = $1`,
    [req.params.codigo, nome?.trim() || null, categoria || null]);
  res.json({ ok: true });
});

app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ erro: 'Erro no servidor.' });
});

if (require.main === module) {
  app.listen(PORTA, () => console.log(`Mercado da casa na porta ${PORTA}`));
}

module.exports = app;
