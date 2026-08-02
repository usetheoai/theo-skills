import { describe, expect, it } from 'vitest';

import { normalizeBaseUrl, withWorkspace } from '../src/client.js';

/**
 * LT-032 — `--registry` terminando em `/v1` produzia `/v1/v1/skills/...`, e o usuário lia
 * "skill não encontrada".
 *
 * São DOIS defeitos, e o segundo é o que fecha a classe. Normalizar sem corrigir a mensagem
 * esconde este caso e deixa o próximo endereço errado produzir a mesma mentira: o sintoma
 * ("a skill não existe") a várias camadas da causa ("o endereço não respondeu"), com toda a
 * aparência de legitimidade. Quem lê vai procurar a skill, republicar, conferir o nome — tudo
 * no lugar errado.
 */
describe('normalizeBaseUrl — remove só o que duplica, e nada além', () => {
  // O par que DISCRIMINA. Um teste que só verificasse "https://host/v1 → https://host"
  // passaria numa implementação que apagasse todo "/v1" da string — inclusive de um endereço
  // legítimo que precisa dele. Os casos de baixo são os que matam essa implementação.
  it.each([
    ['https://host/v1', 'https://host', 'segmento final /v1 — duplicaria'],
    ['https://host/v1/', 'https://host', 'idem, com barra final'],
    ['https://host/v1///', 'https://host', 'idem, com barras repetidas'],
    ['https://host/api/v1', 'https://host/api', 'montado sob /api — só o /v1 final sai'],
  ])('normaliza %s → %s (%s)', (entrada, esperado) => {
    expect(normalizeBaseUrl(entrada)).toBe(esperado);
  });

  it.each([
    ['https://v1.example.com', 'o "v1" está no HOST, não no caminho'],
    ['https://host/v1beta', 'o segmento é v1beta, não v1'],
    ['https://host/v1/extra', 'o /v1 não é final — o serviço vive abaixo dele'],
    ['https://host/service-v1', 'sufixo de um nome, não um segmento'],
    ['https://host', 'nada a normalizar'],
  ])('NÃO altera %s (%s)', (entrada) => {
    expect(normalizeBaseUrl(entrada)).toBe(entrada);
  });
});

describe('o erro precisa falar do ENDEREÇO quando o endereço é que falhou', () => {
  /** 404 do serviço: corpo tipado, com `code`. É a skill que não existe. */
  const respostaTipada = () =>
    Promise.resolve(
      new Response(JSON.stringify({ code: 'not_found', message: 'skill não existe' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    );
  /** 404 de borda: HTML de proxy. Ninguém do serviço respondeu. */
  const respostaDeBorda = () =>
    Promise.resolve(
      new Response('<html><body>404 Not Found</body></html>', {
        status: 404,
        headers: { 'content-type': 'text/html' },
      }),
    );

  it('404 TIPADO continua significando "a skill não existe"', async () => {
    const c = withWorkspace({ baseUrl: 'https://host', auth: 't', fetch: respostaTipada });
    await expect(c.get('inexistente')).resolves.toBeNull();
  });

  it('404 SEM corpo tipado vira erro que menciona o ENDEREÇO, não a skill', async () => {
    const c = withWorkspace({
      baseUrl: 'https://host',
      auth: 't',
      fetch: respostaDeBorda,
      attempts: 1,
    });
    // Afirmar "lançou um erro" não discriminaria: a implementação anterior também poderia
    // lançar. O que se afirma aqui é o CONTEÚDO — que o texto aponta para o endereço e para
    // a opção que o usuário digitou, e que NÃO afirma que a skill não existe.
    await expect(c.get('existe-de-verdade')).rejects.toThrow(/endereço|--registry/i);
    await expect(c.get('existe-de-verdade')).rejects.not.toThrow(/skill não (existe|encontrada)/i);
  });
});
