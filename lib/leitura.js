// Leitura do cupom (NFC-e) a partir de fotos, usando a API do Claude.
// A consulta automática no portal da SEFAZ-MG exige reCAPTCHA, por isso a foto é o caminho.
const Anthropic = require('@anthropic-ai/sdk');

const MODELO = process.env.MODELO_LEITURA || 'claude-opus-5-5';

const CATEGORIAS = [
  'Mercearia', 'Carnes e ovos', 'Laticínios', 'Hortifrúti', 'Padaria e lanches',
  'Bebidas', 'Limpeza', 'Higiene', 'Pet', 'Casa e jardim', 'Outros',
];

// campo que pode vir vazio
const nulo = (schema, description) => ({ anyOf: [schema, { type: 'null' }], ...(description && { description }) });

const ITEM = {
  type: 'object',
  properties: {
    codigo: { type: 'string', description: 'Código do produto como impresso (EAN de 8 a 14 dígitos, ou código interno curto da loja)' },
    descricao: { type: 'string' },
    quantidade: { type: 'number', description: 'Quantidade (em kg para itens pesados)' },
    unidade: { type: 'string', description: 'UN, PT, KG, CX, FR, TB...' },
    preco_unit: { type: 'number' },
    desconto: { type: 'number', description: 'Valor do desconto em reais aplicado a este item (positivo), 0 se não houver' },
    valor_total: { type: 'number', description: 'Valor final do item já com o desconto' },
    categoria: { type: 'string', enum: CATEGORIAS },
    conteudo: nulo({ type: 'number' }, 'Conteúdo da embalagem convertido: 400G -> 0.4, 3L -> 3, 750ML -> 0.75, C/30 -> 30'),
    conteudo_unid: nulo({ type: 'string', enum: ['kg', 'L', 'un'] }),
  },
  required: ['codigo', 'descricao', 'quantidade', 'unidade', 'preco_unit', 'desconto', 'valor_total', 'categoria', 'conteudo', 'conteudo_unid'],
  additionalProperties: false,
};

const SCHEMA = {
  type: 'object',
  properties: {
    loja: {
      type: 'object',
      properties: {
        nome: { type: 'string' },
        cnpj: nulo({ type: 'string' }, 'Só dígitos'),
        cidade: nulo({ type: 'string' }),
      },
      required: ['nome', 'cnpj', 'cidade'],
      additionalProperties: false,
    },
    data: nulo({ type: 'string' }, 'Data e hora da emissão em ISO 8601 (AAAA-MM-DDTHH:MM:SS)'),
    chave: nulo({ type: 'string' }, 'Chave de acesso de 44 dígitos, só dígitos'),
    numero: nulo({ type: 'string' }, 'Número da NFC-e'),
    total: nulo({ type: 'number' }, 'Valor a pagar'),
    qtd_total_itens: nulo({ type: 'number' }, 'Campo "Qtde. Total de Itens" do cupom'),
    forma_pagamento: nulo({ type: 'string' }),
    itens: { type: 'array', items: ITEM },
    observacoes: { type: 'string', description: 'Partes ilegíveis, cortadas ou que faltam nas fotos; vazio se tudo certo' },
  },
  required: ['loja', 'data', 'chave', 'numero', 'total', 'qtd_total_itens', 'forma_pagamento', 'itens', 'observacoes'],
  additionalProperties: false,
};

const INSTRUCOES = `Estas fotos são partes de UM cupom fiscal (NFC-e) de supermercado brasileiro. Extraia a nota completa.

Como as fotos chegam:
- Podem vir fora de ordem (o cabeçalho com CNPJ e "CODIGO DESCRICAO" é o começo; "Qtde. Total de Itens" e o QR Code são o fim). Monte a ordem certa antes de extrair.
- Fotos vizinhas costumam se sobrepor: as mesmas linhas aparecem no fim de uma e no começo da outra. Conte essas linhas uma vez só. Use as linhas vizinhas para achar a emenda.
- Linhas iguais seguidas são normais (o cupom lista cada unidade separada, ex.: 6 linhas de café). Dentro de uma mesma foto, nunca junte nem descarte linhas repetidas.

Como ler cada item:
- Uma linha "DESCONTO -x% R$ -y,yy  z,zz" logo abaixo de um item é desconto daquele item: desconto = y,yy e valor_total = z,zz.
- Itens vendidos por peso (ex.: "1,668KG 11,98 19,98") têm quantidade em kg e unidade KG.
- Copie código e descrição como impressos. Não invente itens que não dá para ler: registre o problema em "observacoes".

Confira no fim: a soma de valor_total deve bater com "Valor a Pagar". Se não bater, revise a emenda entre as fotos antes de responder.`;

let cliente;
function claude() {
  cliente ??= new Anthropic();
  return cliente;
}

// fotos: [{ buffer, mimetype }]
async function lerCupom(fotos) {
  const conteudo = fotos.map((f) => ({
    type: 'image',
    source: { type: 'base64', media_type: f.mimetype, data: f.buffer.toString('base64') },
  }));
  conteudo.push({ type: 'text', text: INSTRUCOES });

  const stream = claude().beta.messages.stream({
    model: MODELO,
    max_tokens: 64000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: conteudo }],
  });
  const resp = await stream.finalMessage();

  if (resp.stop_reason === 'refusal') throw new Error('A leitura foi recusada pelo serviço de IA. Tente outras fotos.');
  if (resp.stop_reason === 'max_tokens') throw new Error('O cupom é grande demais para uma leitura só. Divida em duas partes.');
  const texto = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const nota = JSON.parse(texto);

  // normaliza
  if (nota.loja?.cnpj) nota.loja.cnpj = nota.loja.cnpj.replace(/\D/g, '') || null;
  if (nota.chave) {
    nota.chave = nota.chave.replace(/\D/g, '');
    if (nota.chave.length !== 44) nota.chave = null;
  }
  return { nota, uso: resp.usage };
}

module.exports = { lerCupom, CATEGORIAS };
