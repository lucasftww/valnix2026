# Sistema de Categorias Hierárquico - Documentação

## Visão Geral

Este sistema permite criar e gerenciar categorias e subcategorias de forma ilimitada através do painel administrativo, com suporte a drag-and-drop para reorganização.

## Funcionalidades Principais

### 1. Painel Administrativo

Acesse: `/admin` → Aba "Categorias"

**Recursos disponíveis:**
- ✅ Criar categorias principais e subcategorias ilimitadas
- ✅ Editar nome, slug, descrição, ícones e imagens
- ✅ Ativar/desativar categorias
- ✅ Organizar hierarquia com drag-and-drop
- ✅ Visualização em árvore expansível
- ✅ Definir categoria pai para criar subcategorias

### 2. Estrutura de Dados

**Tabela `categories`:**
- `id` - UUID único
- `name` - Nome da categoria
- `slug` - URL amigável (gerada automaticamente)
- `description` - Descrição opcional
- `parent_id` - ID da categoria pai (null para categorias principais)
- `icon_url` - URL do ícone (pequeno, para menus)
- `image_url` - URL da imagem (grande, para banner)
- `display_order` - Ordem de exibição
- `is_active` - Status ativo/inativo

### 3. Navegação Dinâmica

O componente `Navigation` busca automaticamente as categorias do banco de dados e gera:
- Botões para categorias principais
- Dropdowns para categorias com subcategorias
- Ícones ao lado dos nomes (se configurados)

### 4. Páginas de Categoria

**Rota dinâmica:** `/:slug`

Exemplo: `/valorant`, `/fortnite`, `/roblox`

Cada página de categoria exibe:
- Breadcrumb de navegação
- Cabeçalho com ícone e nome da categoria
- Descrição (se configurada)
- Banner de imagem (se configurado)
- Grid de produtos filtrados por categoria

## Como Usar

### Criar uma Nova Categoria Principal

1. Acesse o painel admin → Categorias
2. Clique em "Nova Categoria"
3. Preencha:
   - **Nome**: Ex: "Minecraft"
   - **Slug**: Será gerado automaticamente como "minecraft"
   - **Categoria Pai**: Deixe em "Nenhuma"
   - **Descrição**: Opcional
   - **URL do Ícone**: Opcional (tamanho pequeno)
   - **URL da Imagem**: Opcional (banner grande)
   - **Ativa**: Marque como ativa
4. Clique em "Criar"

### Criar uma Subcategoria

1. No painel de categorias, clique em "Nova Categoria"
2. No campo "Categoria Pai", selecione a categoria principal
3. Preencha os demais campos
4. Clique em "Criar"

A subcategoria aparecerá no dropdown da categoria pai no menu de navegação.

### Reorganizar Categorias

1. Use os ícones de arrastar (⋮⋮) para mover categorias
2. Arraste e solte na posição desejada
3. A ordem será salva automaticamente

### Expandir/Recolher Hierarquia

Clique no ícone de chevron (▶/▼) ao lado de categorias com filhos para expandir/recolher a visualização.

## Exemplos de Uso

### Exemplo 1: Estrutura Simples
```
- Valorant (principal)
- Roblox (principal)
- Fortnite (principal)
```

### Exemplo 2: Estrutura com Subcategorias
```
- Fortnite (principal)
  └─ Contas Fortnite (subcategoria)
  └─ Bundles Fortnite (subcategoria)
  └─ V-Bucks (subcategoria)

- Free Fire (principal)
  └─ Contas Free Fire (subcategoria)
  └─ Diamantes (subcategoria)
```

### Exemplo 3: Hierarquia Profunda
```
- Jogos (principal)
  └─ Battle Royale (subcategoria)
      └─ Fortnite (sub-subcategoria)
      └─ Free Fire (sub-subcategoria)
  └─ MOBA (subcategoria)
      └─ League of Legends (sub-subcategoria)
```

## Integração com Produtos

Para associar produtos a uma categoria:

1. No painel admin → Produtos
2. Ao criar/editar um produto, defina o campo `category` com o **slug** da categoria
3. Ex: Para categoria "Valorant" com slug "valorant", use `category: "valorant"`

Os produtos serão exibidos automaticamente na página da categoria correspondente.

## Rotas Customizadas vs Dinâmicas

### Rotas Específicas (Mantidas para compatibilidade)
- `/fortnite-bundles`
- `/fortnite-accounts`
- `/roblox`
- `/valorant`
- etc.

### Rota Dinâmica (Nova)
- `/:slug` - Funciona para qualquer categoria criada no admin

**Nota:** As rotas específicas têm prioridade sobre a rota dinâmica. Se você quiser usar apenas rotas dinâmicas, pode remover as rotas específicas do `App.tsx`.

## Segurança

- ✅ Somente admins podem criar/editar categorias
- ✅ Usuários veem apenas categorias ativas
- ✅ RLS (Row Level Security) configurado
- ✅ Validação de permissões no backend

## Funções do Banco de Dados

### `get_categories_tree()`
Retorna a hierarquia completa de categorias em estrutura de árvore recursiva.

Uso no SQL:
```sql
SELECT * FROM get_categories_tree();
```

## Migração de Dados

Se você já tem categorias antigas sem hierarquia, pode:

1. Criar novas categorias no admin
2. Associar produtos às novas categorias
3. Desativar categorias antigas gradualmente

## Troubleshooting

### Categoria não aparece no menu
- Verifique se está marcada como "Ativa"
- Confirme que não há erros no console
- Recarregue a página

### Produtos não aparecem na página da categoria
- Verifique se o campo `category` do produto corresponde ao `slug` da categoria
- Confirme que os produtos estão ativos (`is_active: true`)

### Drag-and-drop não funciona
- Certifique-se de estar usando um navegador moderno
- Verifique se o pacote `@hello-pangea/dnd` está instalado

## Tecnologias Utilizadas

- **React Query**: Cache e sincronização de dados
- **@hello-pangea/dnd**: Drag-and-drop
- **Supabase**: Backend e banco de dados
- **Shadcn UI**: Componentes de interface

## Próximos Passos

- [ ] Adicionar imagens de upload direto
- [ ] Implementar busca de categorias
- [ ] Adicionar filtros avançados
- [ ] Criar relatórios por categoria
- [ ] Implementar importação/exportação em massa
