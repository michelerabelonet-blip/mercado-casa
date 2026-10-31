const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const c = require('../lib/cupom');

const fixture = (f) => fs.readFileSync(path.join(__dirname, 'fixtures', f + '.txt'), 'utf8');

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

test('monta a nota das 3 fotos reais do Mart Minas', () => {
  const n = c.montarNota(['martminas-2-meio', 'martminas-3-fim', 'martminas-1-inicio'].map(fixture));
  assert.equal(n.loja.cnpj, '04737552001029');
  assert.equal(n.data, '2026-10-30T20:31:17');
  assert.equal(n.total, 1012.04);
  // as fotos têm trechos ilegíveis: o importante é a maioria dos códigos sair válida
  const validos = n.itens.filter((i) => c.eanValido(i.codigo)).length;
  assert.ok(n.itens.length >= 60, `itens: ${n.itens.length}`);
  assert.ok(validos >= 50, `EAN válidos: ${validos}`);
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
