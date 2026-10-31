const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const c = require('../lib/cupom');

const arquivo = (f) => path.join(__dirname, 'fixtures', f + '.txt');
const fixture = (f) => fs.readFileSync(arquivo(f), 'utf8');
// notas reais ficam só na máquina (test/fixtures está no .gitignore); sem elas, o teste é pulado
const semNota = (...fs_) => ({ skip: fs_.some((f) => !fs.existsSync(arquivo(f))) && 'sem as notas reais em test/fixtures' });

test('valida e conserta EAN com letras trocadas pelo OCR', () => {
  assert.equal(c.eanValido('7896324400021'), true);
  assert.equal(c.lerCodigo('T896324400021'), '7896324400021');
  assert.equal(c.lerCodigo('77896324400021'), '7896324400021'); // dígito dobrado
  assert.equal(c.lerCodigo('PANET'), null);
});

test('lê item, item com valores na linha de baixo, peso e desconto', () => {
  const r = c.lerTexto([
    '7896324400021 CAFE PO CAJUBA 500G ALMOF 1PT 29,90 29,90',
    '7891164015459 FILEZINHO SASSAMI AURORA 1kg CONG',
    '1PT 17,98 17,98',
    'DESCONTO -11,12% R$ -2,00 15,98',
    '934 FLV TOMATE LONGA VIDA kg 1,668KG 11,98 19,98',
  ].join('\n'));
  assert.equal(r.itens.length, 3);
  assert.deepEqual(
    r.itens.map((i) => [i.codigo, i.quantidade, i.preco_unit, i.desconto, i.valor_total]),
    [['7896324400021', 1, 29.9, 0, 29.9], ['7891164015459', 1, 17.98, 2, 15.98], ['934', 1.668, 11.98, 0, 19.98]],
  );
});

test('entende quantidade escrita (texto de PDF) e deduz pelo total', () => {
  const r = c.lerTexto([
    '7896327516132 GELAT APTI 20G ABACAXI 6 UN 1,39 8,34',
    '7896324400021 CAFE PO CAJUBA 500G ALMOF 29,90 179,40',
  ].join('\n'));
  assert.deepEqual(r.itens.map((i) => [i.quantidade, i.unidade, i.valor_total, i.conferir]), [[6, 'UN', 8.34, false], [6, 'UN', 179.4, false]]);
});

test('monta a nota das 3 fotos reais do Mart Minas', semNota('martminas-1-inicio', 'martminas-2-meio', 'martminas-3-fim'), () => {
  const n = c.montarNota(['martminas-2-meio', 'martminas-3-fim', 'martminas-1-inicio'].map(fixture));
  assert.equal(n.loja.cnpj, '04737552001029');
  assert.equal(n.data, '2026-10-30T20:31:17');
  assert.equal(n.total, 1012.04);
  // as fotos têm trechos ilegíveis: o importante é a maioria dos códigos sair válida
  const validos = n.itens.filter((i) => c.eanValido(i.codigo)).length;
  assert.ok(n.itens.length >= 60, `itens: ${n.itens.length}`);
  assert.ok(validos >= 50, `EAN válidos: ${validos}`);
});

test('lê o PDF real da SEFAZ-MG: 103 itens, soma igual ao total e desconto geral', semNota('sefaz-mg-pdf'), () => {
  const n = c.lerSefaz(fixture('sefaz-mg-pdf'));
  assert.equal(n.itens.length, 103);
  assert.equal(n.loja.cnpj, '04737552001029');
  assert.equal(n.loja.cidade, 'UBERLANDIA');
  assert.equal(n.total, 1017.36);
  assert.equal(n.valor_pago, 1012.04);
  assert.equal(n.desconto_geral, 5.32);
  assert.equal(n.qtd_total_itens, 103);
  const soma = Math.round(n.itens.reduce((s, i) => s + i.valor_total, 0) * 100) / 100;
  assert.equal(soma, 1017.36);
  const tomate = n.itens.find((i) => i.descricao.startsWith('FLV TOMATE'));
  assert.deepEqual([tomate.codigo, tomate.quantidade, tomate.unidade, tomate.preco_unit], ['10475', 1.668, 'KG', 11.98]);
  assert.equal(n.itens.filter((i) => i.codigo === '148597').length, 6); // 6 cafés
});

test('lê o layout de MG com colunas misturadas (dados inventados)', () => {
  const n = c.lerSefaz([
    'Nota Fiscal de Consumidor Eletrônica (NFC-e)',
    'SUPERMERCADO EXEMPLO LTDA',
    'CNPJ: 11222333000181 -, Inscrição Estadual: 0',
    'RUA A, 1, CENTRO, 3170206 - UBERLANDIA, MG',
    ' Filtar ítens...',
    'ARROZ TIPO 1 5KG (Código: Qtde total de ítens: UN: Valor total R$:',
    '1234) 2.0000 PT R$ 50,00',
    'Qtde total de ítens: UN: Valor total R$:',
    'BANANA PRATA kg (Código: 55)',
    '0.8000 KG R$ 4,00',
    'Qtde total de ítens 3',
    'Valor total R$ 54.00',
    'Valor pago R$ 53.00',
    'Forma de Pagamento 03 - Cartao de Credito',
  ].join('\n'));
  assert.deepEqual(n.itens.map((i) => [i.codigo, i.quantidade, i.unidade, i.preco_unit, i.valor_total]),
    [['1234', 2, 'PT', 25, 50], ['55', 0.8, 'KG', 5, 4]]);
  assert.deepEqual([n.total, n.valor_pago, n.desconto_geral, n.qtd_total_itens, n.forma_pagamento], [54, 53, 1, 3, 'Cartao de Credito']);
});

test('corrige com o cadastro e reconhece texto da SEFAZ', () => {
  const nota = { itens: [{ codigo: '7896324400O21'.replace('O', '9'), descricao: 'CAFE PO CAJUGBA 500G ALHOF', quantidade: 1, unidade: 'PT', preco_unit: 29.9, desconto: 0, valor_total: 29.9, conferir: true }] };
  c.corrigirComCadastro(nota, [{ codigo: '7896324400021', descricao: 'CAFE PO CAJUBA 500G ALMOF', categoria: 'Mercearia' }]);
  assert.equal(nota.itens[0].codigo, '7896324400021');
  assert.equal(nota.itens[0].categoria, 'Mercearia');
  assert.equal(nota.itens[0].conferir, false);

  const s = c.lerSefaz('CAFE PO CAJUBA 500G (Código: 7896324400021) Qtde.:6 UN: PT Vl. Unit.: 29,90 Vl. Total 179,40\nValor a pagar R$: 179,40');
  assert.deepEqual(s.itens.map((i) => [i.codigo, i.quantidade, i.valor_total]), [['7896324400021', 6, 179.4]]);
  assert.equal(c.chaveDoQr('https://x/qrcode.xhtml?p=31261004737552001029651120002031591449015694|2|1|1|B6'), '31261004737552001029651120002031591449015694');
});
