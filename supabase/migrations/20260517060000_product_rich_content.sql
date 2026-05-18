-- ============================================================================
-- Seed rich product content for the 19 existing products.
-- All products were missing description/rich_description/instructions, which
-- hurts SEO, trust, and support load (customers ask "how do I redeem?").
--
-- Idempotent: only updates rows where the field is currently NULL/empty, so
-- this won't overwrite admin edits.
-- ============================================================================

-- ── Valorant (VP) ──────────────────────────────────────────────────────────
update public.products set
  description = coalesce(nullif(description, ''),
    'Recarregue seus Valorant Points (VP) com segurança e entrega rápida via código. Pagamento PIX confirmado em segundos. Use seus VP para comprar skins, contratos de agente, passes de batalha e muito mais.'),
  rich_description = coalesce(nullif(rich_description, ''),
    '<h3>O que você recebe</h3><p>Um <strong>código Valorant Points</strong> oficial Riot Games para resgate imediato na sua conta.</p>'
    || '<h3>Como resgatar</h3><ol><li>Acesse <a href="https://recharge.riotgames.com" target="_blank" rel="noopener">recharge.riotgames.com</a></li>'
    || '<li>Faça login na conta Riot</li><li>Selecione <em>Valorant</em></li>'
    || '<li>Cole o código recebido e confirme</li></ol>'
    || '<h3>O que dá pra fazer com VP?</h3><ul><li>Comprar skins exclusivas de armas</li>'
    || '<li>Adquirir o Passe de Batalha</li><li>Desbloquear agentes via Contrato</li>'
    || '<li>Comprar buddies, sprays e cartões de jogador</li></ul>'),
  instructions = coalesce(nullif(instructions, ''),
    'Códigos VP são únicos e não-reembolsáveis após o resgate. Funciona em qualquer região atendida pela Riot Games. Em caso de problema com o código, fale com nosso suporte no WhatsApp em até 7 dias.'),
  terms_conditions = coalesce(nullif(terms_conditions, ''),
    'Produto digital, entrega via código. Não há reembolso após o código ser resgatado. Reposição garantida em caso de código inválido. Suporte 7 dias por semana.')
where category = 'valorant';

-- ── Roblox ─────────────────────────────────────────────────────────────────
update public.products set
  description = coalesce(nullif(description, ''),
    'Adicione Robux à sua conta Roblox com entrega rápida via código. Compre acessórios, passes, jogos premium e itens exclusivos com a moeda oficial do Roblox.'),
  rich_description = coalesce(nullif(rich_description, ''),
    '<h3>O que você recebe</h3><p>Um <strong>código Roblox Gift Card</strong> oficial para resgate imediato.</p>'
    || '<h3>Como resgatar</h3><ol><li>Acesse <a href="https://www.roblox.com/redeem" target="_blank" rel="noopener">roblox.com/redeem</a></li>'
    || '<li>Faça login na conta</li><li>Cole o PIN recebido</li><li>Confirme — Robux na hora!</li></ol>'
    || '<h3>O que dá pra comprar com Robux?</h3><ul><li>Acessórios e roupas exclusivas</li>'
    || '<li>Passes premium em jogos populares (Adopt Me, Brookhaven, Bloxburg, etc.)</li>'
    || '<li>Itens raros de catálogo</li><li>Animações e gestos</li></ul>'),
  instructions = coalesce(nullif(instructions, ''),
    'O código é resgatado uma única vez. Após o resgate, os Robux ficam disponíveis na sua conta imediatamente. Funciona em qualquer país. Em caso de problema, contate o suporte em até 7 dias.'),
  terms_conditions = coalesce(nullif(terms_conditions, ''),
    'Produto digital, entrega via código PIN. Sem reembolso após o resgate. Garantia de reposição se o código vier inválido. Use no app Roblox ou no site.')
where category = 'roblox';

-- ── League of Legends (RP) ─────────────────────────────────────────────────
update public.products set
  description = coalesce(nullif(description, ''),
    'Recarregue seus Riot Points (RP) com segurança e velocidade. Compre skins, campeões, Passe de Eventos e muito mais no League of Legends, TFT e Wild Rift.'),
  rich_description = coalesce(nullif(rich_description, ''),
    '<h3>O que você recebe</h3><p>Um <strong>código Riot Points</strong> oficial para resgate imediato.</p>'
    || '<h3>Como resgatar</h3><ol><li>Acesse <a href="https://recharge.riotgames.com" target="_blank" rel="noopener">recharge.riotgames.com</a></li>'
    || '<li>Faça login na conta Riot</li><li>Selecione <em>League of Legends</em></li>'
    || '<li>Cole o código e confirme</li></ol>'
    || '<h3>O que dá pra comprar com RP?</h3><ul><li>Skins exclusivas e edições limitadas</li>'
    || '<li>Campeões e passes de Wild Rift / TFT</li><li>Passe de Batalha por temporada</li>'
    || '<li>Chromas, ícones e emotes</li></ul>'),
  instructions = coalesce(nullif(instructions, ''),
    'Códigos RP são válidos para a região configurada na conta Riot. Resgate único e não-reembolsável após o uso. Em caso de problema com o código, suporte WhatsApp em até 7 dias.'),
  terms_conditions = coalesce(nullif(terms_conditions, ''),
    'Produto digital, entrega via código. Sem reembolso após o código ser resgatado. Reposição garantida para códigos inválidos.')
where category = 'league-of-legends';
