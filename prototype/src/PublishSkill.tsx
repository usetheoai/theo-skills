import {
  Alert,
  Badge,
  Button,
  Card,
  CodeBlock,
  FileDropzone,
  FormField,
  Input,
  Progress,
  Select,
  StatusDot,
  Stepper,
  TagInput,
  Textarea,
} from '@usetheo/ui';
import { Check, FilePlus2, FileWarning, Minus, PackageOpen, ShieldAlert, Upload, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import {
  BODY_SKELETON,
  CHECKS,
  EDITOR_CHECKS,
  LIMITS,
  composeSkillMd,
  describeSkillId,
  type CheckResult,
  type PublishSource,
} from './data/publish';

type Phase = 'package' | 'validate' | 'identity' | 'publish';

const PHASES: { id: Phase; label: string }[] = [
  { id: 'package', label: 'Pacote' },
  { id: 'validate', label: 'Validação' },
  { id: 'identity', label: 'Identidade' },
  { id: 'publish', label: 'Publicação' },
];

/** Estados reais de OperationState (contract/index.ts) pelos quais um create passa. */
const OP_TIMELINE = [
  { at: 0, state: 'CREATING', detail: 'operação enfileirada (pg-boss)' },
  { at: 900, state: 'CREATING', detail: 'validando payload' },
  { at: 1900, state: 'CREATING', detail: 'gerando embedding do texto da skill' },
  { at: 2900, state: 'ACTIVE', detail: 'revisão 1 publicada' },
] as const;

const CATEGORIES = ['infra', 'sre', 'database', 'security', 'api', 'observability', 'ai', 'build'];
const TOOL_SUGGESTIONS = ['read', 'write', 'bash', 'web', 'mcp'];

function CheckRow({ check }: { check: CheckResult }) {
  const icon = {
    pass: { Icon: Check, tone: 'text-success' },
    fail: { Icon: X, tone: 'text-destructive' },
    warn: { Icon: FileWarning, tone: 'text-warning' },
    skip: { Icon: Minus, tone: 'text-muted-foreground' },
  }[check.status];

  return (
    <li className="flex items-start gap-3 py-2">
      <icon.Icon className={`mt-0.5 size-4 shrink-0 ${icon.tone}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm">{check.label}</p>
        <p className="text-xs text-muted-foreground">{check.detail}</p>
      </div>
      <Badge variant="outline" size="sm" className="shrink-0 font-mono">
        {check.code}
      </Badge>
    </li>
  );
}

/**
 * Deep-link do wizard: `#tab=publish:<passo>` abre num passo, e
 * `#tab=publish:editor` / `:upload` abre já na origem escolhida.
 */
function stateFromHash(): { phase: Phase; source: PublishSource | null } {
  const wanted = window.location.hash.split(':')[1] ?? '';
  if (wanted === 'editor' || wanted === 'upload') return { phase: 'package', source: wanted };
  if (PHASES.some((p) => p.id === wanted)) {
    return { phase: wanted as Phase, source: wanted === 'package' ? null : 'upload' };
  }
  return { phase: 'package', source: null };
}

export function PublishSkill() {
  const initial = stateFromHash();
  const [phase, setPhase] = useState<Phase>(initial.phase);
  const [source, setSource] = useState<PublishSource | null>(initial.source);
  const [fileName, setFileName] = useState<string | null>(
    initial.phase === 'package' ? null : 'cloud-resource-manager.zip',
  );

  // Editor — o SKILL.md escrito na própria UI.
  const [name, setName] = useState('');
  const [edDescription, setEdDescription] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [category, setCategory] = useState('');
  const [allowedTools, setAllowedTools] = useState<string[]>(['read']);
  const [body, setBody] = useState('');

  // Identidade (passo 3) — pré-preenchida quando veio do editor.
  const [skillId, setSkillId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [elapsed, setElapsed] = useState(0);

  const idCheck = useMemo(() => describeSkillId(skillId), [skillId]);
  const checks = source === 'editor' ? EDITOR_CHECKS : CHECKS;
  const failures = checks.filter((c) => c.status === 'fail');
  const skillMd = useMemo(
    () => composeSkillMd({ name, description: edDescription, version, category, allowedTools, body }),
    [name, edDescription, version, category, allowedTools, body],
  );

  useEffect(() => {
    if (phase !== 'publish') return;
    const started = Date.now();
    const t = setInterval(() => setElapsed(Date.now() - started), 120);
    return () => clearInterval(t);
  }, [phase]);

  const opSteps = OP_TIMELINE.filter((s) => elapsed >= s.at);
  const opDone = elapsed >= OP_TIMELINE[OP_TIMELINE.length - 1]!.at;
  const phaseIndex = PHASES.findIndex((p) => p.id === phase);

  /** Sair do pacote para a validação carrega o que o editor já sabe. */
  const goValidate = () => {
    if (source === 'editor') {
      setSkillId(name);
      setDisplayName(
        name
          .split('-')
          .map((w) => (w[0]?.toUpperCase() ?? '') + w.slice(1))
          .join(' '),
      );
      setDescription(edDescription);
    }
    setPhase('validate');
  };

  const editorReady = name.trim() !== '' && edDescription.trim() !== '';

  return (
    <div className="space-y-6">
      <Alert
        intent="warning"
        title="Publicar pela web não está em nenhum milestone"
        description="Hoje o único caminho de autoria é a CLI (M5) e a API HTTP. Esta tela é uma proposta: se ela entrar, vira escopo novo — com upload autenticado, limite de corpo e quem-pode-publicar (M6) junto."
      />

      <Card>
        <Card.Body>
          <Stepper
            label="Etapas da publicação"
            orientation="horizontal"
            steps={PHASES.map((p, i) => ({
              id: p.id,
              label: p.label,
              status: i < phaseIndex ? 'done' : i === phaseIndex ? 'active' : 'pending',
            }))}
          />
        </Card.Body>
      </Card>

      {/* ── 1 · origem ────────────────────────────────────────────────────── */}
      {phase === 'package' && source === null && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card
            className="cursor-pointer transition-colors hover:border-primary/50"
            role="button"
            tabIndex={0}
            onClick={() => setSource('upload')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setSource('upload');
              }
            }}
          >
            <Card.Header>
              <PackageOpen className="size-6 text-muted-foreground" aria-hidden="true" />
              <Card.Title className="mt-2">Enviar um pacote pronto</Card.Title>
              <Card.Description>
                Você já tem a skill em disco — com <span className="font-mono">scripts/</span>,{' '}
                <span className="font-mono">references/</span> e o que mais precisar.
              </Card.Description>
            </Card.Header>
            <Card.Body>
              <p className="text-xs text-muted-foreground">
                É o caminho que espelha a CLI: mesmo zip, mesmas regras.
              </p>
            </Card.Body>
          </Card>

          <Card
            className="cursor-pointer transition-colors hover:border-primary/50"
            role="button"
            tabIndex={0}
            onClick={() => setSource('editor')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setSource('editor');
              }
            }}
          >
            <Card.Header>
              <FilePlus2 className="size-6 text-muted-foreground" aria-hidden="true" />
              <Card.Title className="mt-2">Escrever aqui mesmo</Card.Title>
              <Card.Description>
                Preencha os campos e a UI monta o <span className="font-mono">SKILL.md</span> — sem zip,
                sem terminal.
              </Card.Description>
            </Card.Header>
            <Card.Body>
              <p className="text-xs text-muted-foreground">
                Bom para uma skill só de instruções. Precisa de scripts? Envie um pacote.
              </p>
            </Card.Body>
          </Card>
        </div>
      )}

      {/* ── 1a · upload ───────────────────────────────────────────────────── */}
      {phase === 'package' && source === 'upload' && (
        <Card>
          <Card.Header>
            <Card.Title>1 · Envie o pacote da skill</Card.Title>
            <Card.Description>
              Um .zip com <span className="font-mono">SKILL.md</span> na raiz e, opcionalmente,{' '}
              <span className="font-mono">scripts/</span>, <span className="font-mono">references/</span>{' '}
              e <span className="font-mono">assets/</span>.
            </Card.Description>
          </Card.Header>
          <Card.Body className="space-y-4">
            <FileDropzone
              label="Arraste o .zip da skill ou clique para escolher"
              accept={{ 'application/zip': ['.zip'] }}
              maxFiles={1}
              maxSize={LIMITS.maxUploadBytes}
              onFilesAccepted={(files) => {
                const f = files[0];
                if (f) {
                  setFileName(f.name);
                  setPhase('validate');
                }
              }}
              instructions={
                /* `instructions` SUBSTITUI o hint padrão — sem repor a afordância de
                   arrastar/clicar, a área fica só um retângulo tracejado vazio. */
                <span className="flex flex-col items-center gap-2 py-2">
                  <Upload className="size-6 text-muted-foreground" aria-hidden="true" />
                  <span className="text-sm">Arraste o .zip aqui ou clique para escolher</span>
                  <span className="text-xs text-muted-foreground">
                    até {LIMITS.maxUploadMb} MB — o mesmo teto do corpo aceito pela API
                  </span>
                </span>
              }
            />

            <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
              <Button variant="ghost" size="sm" onClick={() => setSource(null)}>
                Trocar de método
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setFileName('cloud-resource-manager.zip');
                  setPhase('validate');
                }}
              >
                Usar pacote de exemplo
              </Button>
            </div>

            <Alert
              intent="info"
              title="O mesmo pacote pela CLI"
              description={
                <CodeBlock code="theoskill validate ./minha-skill && theoskill publish ./minha-skill" terminal />
              }
            />
          </Card.Body>
        </Card>
      )}

      {/* ── 1b · editor ───────────────────────────────────────────────────── */}
      {phase === 'package' && source === 'editor' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <Card.Header>
              <Card.Title>1 · Escreva a skill</Card.Title>
              <Card.Description>
                Estes campos viram o frontmatter Theokit — o mesmo que o parser de M1 exige de um
                pacote enviado.
              </Card.Description>
            </Card.Header>
            <Card.Body className="space-y-5">
              <FormField>
                <FormField.Label required>name</FormField.Label>
                <FormField.Control>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="cloud-resource-manager"
                    className="font-mono"
                  />
                </FormField.Control>
                <FormField.Hint>
                  Vira o <span className="font-mono">skillId</span> — minúsculas, números e hífens.
                </FormField.Hint>
              </FormField>

              <FormField>
                <FormField.Label required>description</FormField.Label>
                <FormField.Control>
                  <Textarea
                    rows={3}
                    value={edDescription}
                    onChange={(e) => setEdDescription(e.target.value)}
                    placeholder="Use esta skill quando o usuário pedir para criar ou alterar recursos de nuvem…"
                    maxLength={LIMITS.maxDescriptionLength}
                  />
                </FormField.Control>
                <FormField.Hint>
                  {edDescription.length}/{LIMITS.maxDescriptionLength} — escreva como gatilho, não como
                  vitrine: é o texto que o modelo lê para decidir invocar.
                </FormField.Hint>
              </FormField>

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField>
                  <FormField.Label>version</FormField.Label>
                  <FormField.Control>
                    <Input value={version} onChange={(e) => setVersion(e.target.value)} className="font-mono" />
                  </FormField.Control>
                </FormField>

                <FormField>
                  <FormField.Label>category</FormField.Label>
                  <FormField.Control>
                    <Select value={category} onValueChange={setCategory}>
                      <Select.Trigger>
                        <Select.Value placeholder="escolha…" />
                      </Select.Trigger>
                      <Select.Content>
                        {CATEGORIES.map((c) => (
                          <Select.Item key={c} value={c}>
                            {c}
                          </Select.Item>
                        ))}
                      </Select.Content>
                    </Select>
                  </FormField.Control>
                </FormField>
              </div>

              <FormField>
                <FormField.Label>allowed-tools</FormField.Label>
                <FormField.Control>
                  <TagInput
                    value={allowedTools}
                    onChange={setAllowedTools}
                    suggestions={TOOL_SUGGESTIONS}
                    placeholder="read, bash…"
                  />
                </FormField.Control>
                <FormField.Hint>O que a skill pode acionar quando o agente a carrega.</FormField.Hint>
              </FormField>

              <FormField>
                <FormField.Label>Corpo (markdown)</FormField.Label>
                <FormField.Control>
                  <Textarea
                    rows={10}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder={BODY_SKELETON}
                    className="font-mono text-xs"
                  />
                </FormField.Control>
                <FormField.Hint>
                  Vazio? O esqueleto sugerido (Quando usar · Instruções · Guardrails) entra no lugar.
                </FormField.Hint>
              </FormField>

              <div className="flex justify-between gap-3">
                <Button variant="ghost" onClick={() => setSource(null)}>
                  Trocar de método
                </Button>
                <Button onClick={goValidate} disabled={!editorReady}>
                  Validar
                </Button>
              </div>
            </Card.Body>
          </Card>

          <Card className="lg:sticky lg:top-6">
            <Card.Header>
              <Card.Title>SKILL.md gerado</Card.Title>
              <Card.Description>
                É exatamente este arquivo que seria empacotado e enviado — sem etapa escondida.
              </Card.Description>
            </Card.Header>
            <Card.Body>
              <CodeBlock code={skillMd} language="markdown" copyable />
            </Card.Body>
          </Card>
        </div>
      )}

      {/* ── 2 · validação ─────────────────────────────────────────────────── */}
      {phase === 'validate' && (
        <Card>
          <Card.Header>
            <Card.Title>2 · Validação na fronteira</Card.Title>
            <Card.Description>
              {source === 'editor' ? (
                <>Pacote montado a partir do formulário — um SKILL.md na raiz.</>
              ) : (
                <>
                  <span className="font-mono">{fileName}</span> — as mesmas regras que a CLI aplica local
                  e o servidor reaplica no upload. Uma regra, dois consumidores.
                </>
              )}
            </Card.Description>
          </Card.Header>
          <Card.Body className="space-y-4">
            <ul className="divide-y divide-border">
              {checks.map((c) => (
                <CheckRow key={c.code} check={c} />
              ))}
            </ul>

            {failures.length > 0 ? (
              <Alert
                intent="destructive"
                title={`${failures.length} regra(s) bloqueiam a publicação`}
                description="O erro é tipado e aponta arquivo e linha. Corrija e reenvie — o servidor rejeita na fronteira, antes de qualquer persistência."
              />
            ) : (
              <Alert
                intent="success"
                title="Pacote válido"
                description={
                  source === 'editor'
                    ? 'Nenhuma regra violada. O que está marcado como não alcançável é reavaliado no servidor de qualquer forma — a UI é conveniência, a fronteira HTTP é a autoridade.'
                    : 'Nenhuma regra violada.'
                }
              />
            )}

            <div className="flex justify-between gap-3">
              <Button variant="ghost" onClick={() => setPhase('package')}>
                {source === 'editor' ? 'Voltar ao editor' : 'Trocar pacote'}
              </Button>
              <Button onClick={() => setPhase('identity')} disabled={failures.length > 0}>
                {failures.length > 0 ? 'Corrija para continuar' : 'Continuar'}
              </Button>
            </div>
          </Card.Body>
        </Card>
      )}

      {/* ── 3 · identidade ────────────────────────────────────────────────── */}
      {phase === 'identity' && (
        <Card>
          <Card.Header>
            <Card.Title>3 · Identidade da skill</Card.Title>
            <Card.Description>
              O <span className="font-mono">skillId</span> é imutável e continua reservado mesmo depois
              de deletada — escolher aqui é decisão definitiva.
              {source === 'editor' && ' Preenchido a partir do que você escreveu.'}
            </Card.Description>
          </Card.Header>
          <Card.Body className="space-y-5">
            <FormField>
              <FormField.Label required>skillId</FormField.Label>
              <FormField.Control>
                <Input
                  value={skillId}
                  onChange={(e) => setSkillId(e.target.value)}
                  placeholder="cloud-resource-manager"
                  className="font-mono"
                  aria-invalid={skillId !== '' && !idCheck.valid}
                />
              </FormField.Control>
              {skillId !== '' && !idCheck.valid ? (
                <FormField.Error>{idCheck.reason}</FormField.Error>
              ) : (
                <FormField.Hint>
                  1 a {LIMITS.maxSkillIdLength} caracteres · minúsculas, números e hífens · começa com
                  letra e termina com letra ou número · prefixo{' '}
                  <span className="font-mono">{LIMITS.reservedPrefix}</span> é reservado
                </FormField.Hint>
              )}
            </FormField>

            <FormField>
              <FormField.Label required>Nome de exibição</FormField.Label>
              <FormField.Control>
                <Input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Cloud Resource Manager"
                  maxLength={LIMITS.maxNameLength}
                />
              </FormField.Control>
              <FormField.Hint>
                {displayName.length}/{LIMITS.maxNameLength}
              </FormField.Hint>
            </FormField>

            <FormField>
              <FormField.Label required>Descrição</FormField.Label>
              <FormField.Control>
                <Textarea
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Cria e gerencia recursos de nuvem do projeto…"
                  maxLength={LIMITS.maxDescriptionLength}
                />
              </FormField.Control>
              <FormField.Hint>
                {description.length}/{LIMITS.maxDescriptionLength} — é este texto que o modelo lê para
                decidir quando invocar a skill, e o que entra no embedding da busca.
              </FormField.Hint>
            </FormField>

            <div className="flex justify-between gap-3">
              <Button variant="ghost" onClick={() => setPhase('validate')}>
                Voltar
              </Button>
              <Button
                onClick={() => {
                  setElapsed(0);
                  setPhase('publish');
                }}
                disabled={!idCheck.valid || displayName.trim() === '' || description.trim() === ''}
              >
                Publicar
              </Button>
            </div>
          </Card.Body>
        </Card>
      )}

      {/* ── 4 · publicação ────────────────────────────────────────────────── */}
      {phase === 'publish' && (
        <Card>
          <Card.Header>
            <Card.Title>4 · A resposta é uma operação, não a skill</Card.Title>
            <Card.Description>
              <span className="font-mono">POST /v1/skills</span> devolve um id rastreável; o trabalho
              acontece no worker e o cliente acompanha por polling ou webhook.
            </Card.Description>
          </Card.Header>
          <Card.Body className="space-y-4">
            <CodeBlock
              caption="POST /v1/skills"
              code={`{ "operation": { "id": "op_7fk2", "done": ${opDone} } }`}
            />

            <Progress
              value={opDone ? 100 : Math.min(95, (elapsed / 2900) * 100)}
              intent={opDone ? 'success' : 'default'}
              height="h-1.5"
            />

            <ul className="space-y-2">
              {opSteps.map((s) => (
                <li key={s.at} className="flex items-center gap-3 text-sm">
                  <StatusDot status={s.state === 'ACTIVE' ? 'live' : 'building'} size="sm" />
                  <span className="font-mono text-xs">{s.state}</span>
                  <span className="text-muted-foreground">{s.detail}</span>
                </li>
              ))}
            </ul>

            {opDone && (
              <>
                <Alert
                  intent="success"
                  title={`${displayName || 'A skill'} está ACTIVE na revisão 1`}
                  description="A partir daqui, republicar cria a revisão 2 — esta permanece recuperável. O webhook skill.created já foi disparado para os endpoints inscritos."
                />
                <div className="flex justify-end gap-3">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setPhase('package');
                      setSource(null);
                      setFileName(null);
                      setName('');
                      setEdDescription('');
                      setBody('');
                      setSkillId('');
                      setDisplayName('');
                      setDescription('');
                    }}
                  >
                    Publicar outra
                  </Button>
                  <Button>Ver a skill</Button>
                </div>
              </>
            )}
          </Card.Body>
        </Card>
      )}

      <Card>
        <Card.Header>
          <Card.Title className="flex items-center gap-2">
            <ShieldAlert className="size-4 text-warning" aria-hidden="true" />O que esta tela assume e
            ainda não existe
          </Card.Title>
        </Card.Header>
        <Card.Body>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
            <li>
              Upload de arquivo pela web: a API recebe o zip em <span className="font-mono">base64</span>{' '}
              dentro do JSON, com teto de corpo configurável — não há upload multipart nem URL assinada.
            </li>
            <li>
              Empacotar no navegador (caminho do editor) exige gerar o zip no cliente. Nada disso existe
              hoje; a alternativa é um endpoint que aceite o SKILL.md cru e empacote no servidor — decisão
              de contrato em aberto.
            </li>
            <li>
              Quem pode publicar: não há principal autenticado nem permissão por skill (M6). Hoje quem
              alcança a API publica qualquer coisa.
            </li>
            <li>
              Rascunho: o fluxo não persiste entre passos. Um editor de verdade precisa salvar rascunho —
              e aí a pergunta é onde: servidor ou navegador.
            </li>
            <li>
              Validação incremental: aqui os checks aparecem prontos. No servidor eles rodam no worker,
              depois do enfileiramento — a UI teria de exibir falha de validação vinda da operação, não
              do POST.
            </li>
          </ul>
        </Card.Body>
      </Card>
    </div>
  );
}
