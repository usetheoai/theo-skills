import { Alert, Badge, Card, CodeBlock, PageShell, StatusDot, Stepper, Tabs } from '@usetheo/ui';
import type { StatusKind } from '@usetheo/ui';
import { Boxes, Cpu, LayoutGrid, ScanSearch, ShieldCheck, SquareTerminal, Upload } from 'lucide-react';
import { useState, type ElementType } from 'react';

import { PublishSkill } from './PublishSkill';
import { SkillCatalog } from './SkillCatalog';
import { SkillDetail } from './SkillDetail';
import { CATALOG, type CatalogSkill } from './data/catalog';
import { DECISIONS, JOURNEYS, MILESTONES, type Journey, type Line, type Status, type Step } from './data/journeys';

/** Mapas de status → vocabulário do design system. Um lugar só (DRY). */
const BADGE_VARIANT: Record<Status, 'success' | 'warning' | 'outline'> = {
  built: 'success',
  partial: 'warning',
  missing: 'outline',
};

const STATUS_LABEL: Record<Status, string> = {
  built: 'construído',
  partial: 'parcial',
  missing: 'a construir',
};

/** "jornada" é feminino — sem isto o badge lê "jornada construído". */
const STATUS_LABEL_F: Record<Status, string> = {
  built: 'construída',
  partial: 'parcial',
  missing: 'a construir',
};

const DOT_STATUS: Record<Status, StatusKind> = {
  built: 'live',
  partial: 'warning',
  missing: 'idle',
};

/** Stepper só conhece pending | active | done | failed. */
const STEP_STATUS = {
  built: 'done',
  partial: 'active',
  missing: 'pending',
} as const;

const JOURNEY_ICON: Record<string, ElementType> = {
  author: SquareTerminal,
  builder: ScanSearch,
  runtime: Cpu,
  operator: ShieldCheck,
};

/**
 * As linhas viram um bloco único porque `CodeBlock` recebe `code: string`.
 * O prefixo `$` é aplicado aqui (e não via `terminal`, que prefixaria também
 * as linhas de saída).
 */
function linesToCode(lines: readonly Line[]): string {
  return lines.map((l) => (l.kind === 'cmd' ? `$ ${l.text}` : l.text)).join('\n');
}

function MilestoneRow() {
  const done = MILESTONES.filter((m) => m.done).length;
  return (
    <Card>
      <Card.Header>
        <Card.Title>Roadmap</Card.Title>
        <Card.Description>
          {done} de {MILESTONES.length} milestones entregues. Os três abertos — M6 RBAC, M7 Theokit,
          M8 hardening — são o que falta para o V1.
        </Card.Description>
      </Card.Header>
      <Card.Body>
        <div className="flex flex-wrap gap-2">
          {MILESTONES.map((m) => (
            <Badge key={m.id} variant={m.done ? 'success' : 'outline'} title={m.name}>
              {m.id} · {m.name}
            </Badge>
          ))}
        </div>
      </Card.Body>
    </Card>
  );
}

function JourneySummary({ journey }: { journey: Journey }) {
  return (
    <Card className="lg:sticky lg:top-6">
      <Card.Header>
        <Card.Title className="flex items-center gap-2">
          <StatusDot status={DOT_STATUS[journey.status]} size="sm" />
          Etapas
        </Card.Title>
        <Card.Description>{journey.need}</Card.Description>
      </Card.Header>
      <Card.Body>
        <Stepper
          label={`Etapas da jornada ${journey.persona}`}
          orientation="vertical"
          steps={journey.steps.map((s) => ({
            id: String(s.n),
            label: s.title,
            description: STATUS_LABEL[s.status],
            status: STEP_STATUS[s.status],
          }))}
        />
      </Card.Body>
    </Card>
  );
}

function StepCard({ step }: { step: Step }) {
  return (
    <Card>
      <Card.Header>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Card.Title>
              {String(step.n).padStart(2, '0')} · {step.title}
            </Card.Title>
            <Card.Description>{step.actor}</Card.Description>
          </div>
          <Badge variant={BADGE_VARIANT[step.status]}>{STATUS_LABEL[step.status]}</Badge>
        </div>
      </Card.Header>
      <Card.Body className="space-y-4">
        <CodeBlock code={linesToCode(step.screen)} caption={step.screenLabel} copyable />

        <p className="text-sm text-muted-foreground">{step.proves}</p>

        {step.gaps && step.gaps.length > 0 && (
          <Alert
            intent={step.status === 'missing' ? 'destructive' : 'warning'}
            title="Ainda em aberto"
            description={
              <ul className="list-disc space-y-1 pl-4">
                {step.gaps.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            }
          />
        )}

        <div className="flex flex-wrap gap-2">
          {step.milestones.map((id) => {
            const m = MILESTONES.find((x) => x.id === id);
            return (
              <Badge key={id} variant={m?.done ? 'success' : 'outline'} size="sm">
                {id} · {m?.done ? 'entregue' : 'a construir'}
              </Badge>
            );
          })}
        </div>
      </Card.Body>
    </Card>
  );
}

function JourneyView({ journey }: { journey: Journey }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
      <JourneySummary journey={journey} />
      <div className="space-y-4">
        {journey.steps.map((s) => (
          <StepCard key={s.n} step={s} />
        ))}
      </div>
    </div>
  );
}

function DecisionsView() {
  return (
    <div className="space-y-4">
      <Alert
        intent="info"
        title="Nenhuma destas decisões está tomada"
        description="Três saíram da leitura das referências; uma é um risco do próprio roadmap. Cada uma muda o que vamos construir."
      />
      <div className="grid gap-4 md:grid-cols-2">
        {DECISIONS.map((d) => (
          <Card key={d.n}>
            <Card.Header>
              <Card.Title>
                {String(d.n).padStart(2, '0')} · {d.title}
              </Card.Title>
              <Card.Description>fonte · {d.source}</Card.Description>
            </Card.Header>
            <Card.Body className="space-y-4">
              <p className="text-sm text-muted-foreground">{d.body}</p>
              <div className="flex flex-wrap gap-2">
                {d.affects.map((id) => {
                  const m = MILESTONES.find((x) => x.id === id);
                  return (
                    <Badge key={id} variant={m?.done ? 'success' : 'outline'} size="sm">
                      {id}
                    </Badge>
                  );
                })}
              </div>
            </Card.Body>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  /**
   * Catálogo ↔ detalhe. Estado local em vez de router (uma rota só), mas espelhado
   * no hash para o link de uma skill ser compartilhável: #skill=cloud-resource-manager.
   */
  const [selected, setSelected] = useState<CatalogSkill | null>(
    () => CATALOG.find((s) => s.skillId === window.location.hash.replace('#skill=', '')) ?? null,
  );

  const select = (skill: CatalogSkill | null) => {
    setSelected(skill);
    window.location.hash = skill ? `skill=${skill.skillId}` : '';
  };

  /** Aba também no hash (#tab=runtime) para linkar uma jornada específica. */
  const [tab, setTab] = useState(() => {
    /* `split(':')` porque a aba publicar aceita sufixo de passo: #tab=publish:identity */
    const fromHash = window.location.hash.replace('#tab=', '').split(':')[0] ?? '';
    return window.location.hash.startsWith('#tab=') && fromHash !== '' ? fromHash : 'catalog';
  });

  const changeTab = (next: string) => {
    setTab(next);
    window.location.hash = next === 'catalog' ? '' : `tab=${next}`;
  };

  return (
    /* O PageShell não traz gutter próprio: sem este wrapper o conteúdo encosta na
       borda da janela (botões do header ficam cortados em telas estreitas). */
    <div className="mx-auto max-w-[1600px] px-6 py-8 lg:px-10">
      <PageShell
        title="Jornadas e features"
        description="theo-skills · protótipo de alinhamento. Cada passo é marcado pelo que existe no código hoje, não pelo que o roadmap promete."
      >
      <div className="space-y-6">
        <MilestoneRow />

        <Tabs value={tab} onValueChange={changeTab}>
          <Tabs.List>
            <Tabs.Trigger value="catalog" className="gap-2">
              <LayoutGrid className="size-4" aria-hidden="true" />
              Catálogo
            </Tabs.Trigger>
            <Tabs.Trigger value="publish" className="gap-2">
              <Upload className="size-4" aria-hidden="true" />
              Publicar
            </Tabs.Trigger>
            {JOURNEYS.map((j) => {
              const Icon = JOURNEY_ICON[j.id] ?? Boxes;
              return (
                <Tabs.Trigger key={j.id} value={j.id} className="gap-2">
                  <Icon className="size-4" aria-hidden="true" />
                  {j.persona}
                </Tabs.Trigger>
              );
            })}
            <Tabs.Trigger value="decisions" className="gap-2">
              <Boxes className="size-4" aria-hidden="true" />
              Decisões
            </Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="catalog" className="pt-6">
            {selected ? (
              <SkillDetail skill={selected} onBack={() => select(null)} />
            ) : (
              <SkillCatalog onOpen={select} />
            )}
          </Tabs.Content>

          <Tabs.Content value="publish" className="pt-6">
            <PublishSkill />
          </Tabs.Content>

          {JOURNEYS.map((j) => (
            <Tabs.Content key={j.id} value={j.id} className="pt-6">
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <h2 className="text-lg font-medium">{j.persona}</h2>
                <span className="text-sm text-muted-foreground">{j.role}</span>
                <Badge variant={BADGE_VARIANT[j.status]}>jornada {STATUS_LABEL_F[j.status]}</Badge>
              </div>
              <JourneyView journey={j} />
            </Tabs.Content>
          ))}

          <Tabs.Content value="decisions" className="pt-6">
            <DecisionsView />
          </Tabs.Content>
          </Tabs>
        </div>
      </PageShell>
    </div>
  );
}
