# Mercado da casa

App (PWA) para controlar as compras de supermercado. Mostra a evolução do preço de cada produto, o consumo e o gasto por mês, a inflação da sua cesta, os preços que mudaram e uma lista de compras sugerida pelo ritmo de consumo.

A nota entra de três jeitos:

1. **Fotos do cupom (grátis):** o texto é reconhecido no próprio celular (Tesseract) e o servidor monta e corrige os itens (`lib/cupom.js`): conserta códigos de barras pelo dígito verificador, usa o preço repetido do mesmo produto e os produtos já cadastrados. Linhas duvidosas aparecem marcadas para conferir.
2. **Nota da SEFAZ (grátis):** o app lê o QR Code e abre a nota no site da SEFAZ; a pessoa passa pela verificação humana, copia a página e cola no app (`lerSefaz`). O layout de MG ainda precisa ser confirmado com uma nota real.
3. **IA (opcional, pago):** botão "Ler com IA", só aparece se houver `ANTHROPIC_API_KEY`.

## Variáveis de ambiente

| Nome | O que é |
|---|---|
| `DATABASE_URL` | Postgres do Supabase (as tabelas ficam no esquema `mercado`) |
| `APP_SENHA` | Senha única da casa para entrar no app |
| `SESSION_SECRET` | Texto aleatório longo para assinar o cookie de sessão |
| `ANTHROPIC_API_KEY` | Opcional. Liga a leitura por IA |
| `MODELO_LEITURA` | Opcional. Padrão `claude-opus-5-5` |

## Rodar

```bash
npm install
npm test
npm start
```
