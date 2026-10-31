# Mercado da casa

App (PWA) para controlar as compras de supermercado: fotografe o cupom (NFC-e), o app lê os itens com a API do Claude, você confere e salva. Mostra a evolução do preço de cada produto, o consumo e o gasto por mês, a inflação da sua cesta, os preços que mudaram e uma lista de compras sugerida pelo ritmo de consumo.

## Variáveis de ambiente

| Nome | O que é |
|---|---|
| `DATABASE_URL` | Postgres do Supabase (as tabelas ficam no esquema `mercado`) |
| `ANTHROPIC_API_KEY` | Chave da API do Claude, usada na leitura das fotos |
| `APP_SENHA` | Senha única da casa para entrar no app |
| `SESSION_SECRET` | Texto aleatório longo para assinar o cookie de sessão |
| `MODELO_LEITURA` | Opcional. Padrão `claude-opus-5-5` |

## Rodar

```bash
npm install
npm test
npm start
```

A consulta automática da nota no portal da SEFAZ-MG pede reCAPTCHA, por isso a entrada é por foto.
