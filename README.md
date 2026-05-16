# VALNIX

E-commerce de gift cards digitais (Valorant Points, Robux, Riot Points) com pagamento via PIX e entrega automática.

## Stack

- **Frontend**: Vite + React 18 + TypeScript + React Router 6
- **UI**: shadcn/ui (Radix) + Tailwind CSS + Lucide
- **Estado / Data**: TanStack Query + React Context (carrinho)
- **Backend**: Vercel Functions (`/api/*.ts`)
- **Banco**: Supabase (Postgres + RLS)
- **Pagamento**: Dice gateway (PIX)
- **Tracking**: Meta CAPI (server-side relay + log em `analytics_events`)
- **PWA**: vite-plugin-pwa (`src/sw.ts`)
- **Deploy**: Vercel

## Setup local

```sh
# 1. Clonar
git clone <repo-url>
cd valnix2026

# 2. Instalar dependências
npm install

# 3. Configurar variáveis de ambiente
cp .env.example .env.local
# Edite .env.local com as suas chaves Supabase, Dice, etc.

# 4. Subir o schema no Supabase
# Cole o conteúdo de supabase/migrations/20260516000000_initial_schema.sql
# no SQL Editor do dashboard.

# 5. Rodar
npm run dev
```

## Estrutura

```
api/                    Serverless functions (Vercel)
  _utils/               Supabase admin client, Dice auth helper, helpers
  admin-*               Endpoints admin (autenticados via HMAC token)
  dice-pix              PIX gateway adapter
  dice-webhook          Recebe callbacks da Dice
  create-order          Criação de pedido com validação server-side de preço
  process-delivery      Entrega automática de códigos
  server-relay          Log + relay de eventos para Meta CAPI
  ...

src/
  pages/                Rotas (Index, Checkout, Admin /charles, etc.)
  components/
    admin/              Painel admin
    checkout/           Formulário + PIX
    post-payment/       Upsells pós-pagamento
    product/            Produto detail
    ui/                 shadcn primitives
  contexts/             AdminAuthContext, CartContext
  hooks/data/           Hooks de leitura (Supabase)
  hooks/                use-mobile, use-toast, prefetch
  integrations/supabase Cliente front + tipos
  lib/                  publicData, analytics, metaCapi, adminAuth, ...
  bootstrap.ts          UTMs + Pixel base (carrega antes do React)

supabase/migrations/    Schema SQL
scripts/                Utilitários: migração Firestore→Supabase, update Meta creds
```

## Comandos

```sh
npm run dev          # dev server (vite)
npm run build        # produção
npm run lint         # eslint
npx tsc --noEmit -p tsconfig.app.json   # type check
```

## Endpoints `/api`

| Endpoint | Auth | Descrição |
|---|---|---|
| `admin-auth` | — | Login admin (POST) / verifica token (GET) |
| `admin-data` | admin | CRUD genérico de produtos/categorias/orders + dashboard stats |
| `admin-analytics` | admin | Funil de conversão |
| `admin-post-payment` | misto | CRUD de páginas de upsell + tracking de view/skip |
| `monitor-tracking` | admin | Saúde do Meta CAPI |
| `capi-replay` | admin | Reenvio manual de eventos CAPI |
| `create-order` | público | Cria pedido (revalida preço contra catálogo) |
| `dice-pix` | público | Cria/checa cobrança PIX |
| `dice-webhook` | público (validado via Dice API) | Recebe callbacks de pagamento |
| `process-delivery` | admin | Entrega códigos de auto-delivery |
| `server-relay` | público | Log + envio para Meta CAPI |
| `meta-relay` | público | Envio leve para Meta CAPI (sem log) |
| `store-metrics` | público | Log de eventos do front |
| `site-data` | público | Catálogo (fallback) |
| `guest-order` | público (lookup por hash) | Consulta de pedido em `/order/:hash` |
| `post-payment-order-check` | público | Valida order_id na página de upsell |

## Variáveis de ambiente

Veja [`.env.example`](.env.example) — Supabase URL/keys, `ADMIN_PASSWORD`, Meta CAPI, Dice gateway.

## Deploy

Push pra branch principal → Vercel builda automaticamente. As env vars são gerenciadas em
**Vercel → Project → Settings → Environment Variables**.

## Notas

- `admin` em `/charles/*`. A rota `/admin` redireciona pra um vídeo do YouTube (honeypot).
- O admin usa HMAC (`ADMIN_PASSWORD` + nonce + timestamp), sem Firebase Auth.
- Service worker (`src/sw.ts`) pré-cacheia o shell. Force refresh ou bump version se mudar
  endpoints públicos.
