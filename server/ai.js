// KI-Analyse des besten Tankzeitpunkts mit Claude.
// Die Statistik aus analysis.js liefert die Zahlen, Claude bewertet sie und
// formuliert eine begründete Empfehlung als strukturiertes JSON.
import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';

const SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['now', 'wait'], description: 'now = jetzt tanken, wait = auf das Zeitfenster warten' },
    headline: { type: 'string', description: 'Empfehlung in einem kurzen Satz' },
    window_start: { type: ['string', 'null'], description: 'Beginn des empfohlenen Zeitfensters als ISO-8601-Zeitpunkt aus der Prognose, null bei action=now' },
    window_end: { type: ['string', 'null'], description: 'Ende des empfohlenen Zeitfensters, null bei action=now' },
    expected_saving_ct: { type: 'number', description: 'Erwartete Ersparnis in Cent pro Liter gegenüber jetzt, 0 bei action=now' },
    station_id: { type: ['string', 'null'], description: 'ID der empfohlenen Station aus der Liste stationen' },
    confidence: { type: 'string', enum: ['niedrig', 'mittel', 'hoch'] },
    reasoning: { type: 'string', description: 'Begründung in 2 bis 4 Sätzen' },
    caveats: { type: 'array', items: { type: 'string' }, description: 'Einschränkungen der Aussage, kann leer sein' },
  },
  required: ['action', 'headline', 'window_start', 'window_end', 'expected_saving_ct', 'station_id', 'confidence', 'reasoning', 'caveats'],
  additionalProperties: false,
};

const SYSTEM = `Du bist der Analyse-Teil einer App, die Autofahrern in Deutschland sagt, wann und an welcher Tankstelle in ihrer Nähe sie am günstigsten tanken. Der Nutzer wählt eine Marke oder alle Marken; nur diese Stationen kommen für die Empfehlung infrage.

Du bekommst als JSON die gewählte Marke, die aktuellen Preise ihrer Stationen im Umkreis, den Vergleich mit den übrigen Marken (null, wenn alle Marken gewählt sind) und eine statistische Auswertung der Preishistorie, die die App selbst gesammelt hat: mittlere Abweichung vom Tagesmittel je Uhrzeit, Wochentagsmuster, Trend, Verteilung der letzten 7 Tage und eine Stundenprognose für die nächsten 24 Stunden.

Leite daraus eine konkrete Empfehlung ab: jetzt tanken oder auf ein bestimmtes Zeitfenster warten, und an welcher Station. Wäge dabei ab, wie belastbar die Daten sind. Steht bei profileSource der Wert "prior", gibt es noch zu wenig eigene Messwerte und das Tagesprofil ist nur ein allgemeiner Erfahrungswert – dann ist die Aussage entsprechend unsicher. Eine Ersparnis von unter etwa 1,5 ct/l lohnt das Warten meist nicht; ein weiter Umweg zu einer kaum günstigeren Station ebenfalls nicht.

Steht bei datenquelle, dass die Daten simuliert sind, läuft die App im Demo-Modus: Dann sind Stationen, Preise und Historie erfunden. Sprich in diesem Fall nicht von eigenen Messwerten und nenne als erste Einschränkung, dass die Empfehlung auf simulierten Demo-Daten beruht.

Stütze dich ausschließlich auf die gelieferten Zahlen und erfinde keine Preise, Ereignisse oder Marktnachrichten. Zeitfenster entnimmst du den Zeitpunkten der Prognose. Schreibe auf Deutsch, sachlich und knapp, für jemanden, der die Antwort auf dem Handy liest. Preise mit Komma als Dezimaltrennzeichen.`;

let client;

export async function aiRecommendation(payload) {
  client ||= new Anthropic();
  const response = await client.beta.messages.create({
    model: config.aiModel,
    max_tokens: 16000,
    system: SYSTEM,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    // Lehnt ein Sicherheitsfilter die Anfrage ab, beantwortet sie serverseitig ein Ersatzmodell.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    messages: [{ role: 'user', content: JSON.stringify(payload) }],
  });
  if (response.stop_reason === 'refusal') throw new Error('Die KI hat die Anfrage abgelehnt.');
  if (response.stop_reason === 'max_tokens') throw new Error('Die KI-Antwort wurde abgeschnitten.');
  const text = response.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('Die KI hat keine Antwort geliefert.');
  return { ...JSON.parse(text), model: response.model };
}

export function aiErrorMessage(err) {
  if (err instanceof Anthropic.AuthenticationError) return 'Der Claude-API-Key ist ungültig.';
  if (err instanceof Anthropic.RateLimitError) return 'Das Anfragelimit der Claude-API ist erreicht – bitte später erneut versuchen.';
  if (err instanceof Anthropic.APIConnectionError) return 'Die Claude-API ist nicht erreichbar.';
  if (err instanceof Anthropic.APIError) return `Fehler der Claude-API (${err.status ?? '?'}): ${err.message}`;
  return err.message;
}
