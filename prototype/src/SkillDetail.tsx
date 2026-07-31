import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CodeBlock,
  DangerZone,
  DataTable,
  DescriptionList,
  StatusDot,
  Tabs,
  Timestamp,
} from '@usetheo/ui';
import { ArrowLeft, FileArchive, FileText } from 'lucide-react';

import {
  DETAIL_GAPS,
  deliveriesOf,
  payloadOf,
  revisionsOf,
  skillMarkdown,
  type CatalogSkill,
  type Delivery,
  type Revision,
} from './data/catalog';
import { formatBytes, initials, toneFor } from './lib/skill-visuals';

function Overview({ skill }: { skill: CatalogSkill }) {
  const revisions = revisionsOf(skill);
  const current = revisions[0]!;
  const first = revisions[revisions.length - 1]!;

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[1fr_320px]">
      <Card>
        <Card.Header>
          <Card.Title>Descrição</Card.Title>
          <Card.Description>
            É este texto que o modelo lê para decidir quando invocar a skill — e o mesmo que entra no
            embedding da busca.
          </Card.Description>
        </Card.Header>
        <Card.Body className="space-y-4">
          <p className="text-sm">{skill.description}</p>
          <div className="flex flex-wrap gap-1.5">
            {skill.tags.map((t) => (
              <Badge key={t} variant="outline" size="sm">
                {t}
              </Badge>
            ))}
          </div>
        </Card.Body>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title>Identidade</Card.Title>
        </Card.Header>
        <Card.Body>
          <DescriptionList layout="horizontal" dense>
            <DescriptionList.Item>
              <DescriptionList.Term>skillId</DescriptionList.Term>
              <DescriptionList.Detail className="font-mono text-xs">{skill.skillId}</DescriptionList.Detail>
            </DescriptionList.Item>
            <DescriptionList.Item>
              <DescriptionList.Term>estado</DescriptionList.Term>
              <DescriptionList.Detail>
                <StatusDot status="live" size="sm" label="ACTIVE" />
              </DescriptionList.Detail>
            </DescriptionList.Item>
            <DescriptionList.Item>
              <DescriptionList.Term>revisão atual</DescriptionList.Term>
              <DescriptionList.Detail>{current.id}</DescriptionList.Detail>
            </DescriptionList.Item>
            <DescriptionList.Item>
              <DescriptionList.Term>tamanho</DescriptionList.Term>
              <DescriptionList.Detail>{skill.sizeKb} KB</DescriptionList.Detail>
            </DescriptionList.Item>
            <DescriptionList.Item>
              <DescriptionList.Term>criada</DescriptionList.Term>
              <DescriptionList.Detail>
                <Timestamp value={first.createdAt} format="relative" />
              </DescriptionList.Detail>
            </DescriptionList.Item>
            <DescriptionList.Item>
              <DescriptionList.Term>atualizada</DescriptionList.Term>
              <DescriptionList.Detail>
                <Timestamp value={current.createdAt} format="relative" />
              </DescriptionList.Detail>
            </DescriptionList.Item>
          </DescriptionList>
        </Card.Body>
      </Card>
    </div>
  );
}

function Revisions({ skill }: { skill: CatalogSkill }) {
  const revisions = revisionsOf(skill);

  return (
    <div className="space-y-4">
      <Alert
        intent="info"
        title="Revisões são imutáveis"
        description="Publicar de novo cria uma revisão; a anterior continua recuperável. Nada é sobrescrito — é a regra que M1 implementa."
      />
      <Card>
        <Card.Body className="p-0">
          <DataTable<Revision>
            data={revisions}
            rowKey={(r) => String(r.id)}
            columns={[
              {
                key: 'id',
                label: 'Revisão',
                width: '120px',
                render: (r) => (
                  <span className="flex items-center gap-2">
                    <span className="font-mono">rev {r.id}</span>
                    {r.current && (
                      <Badge variant="primary" size="sm">
                        atual
                      </Badge>
                    )}
                  </span>
                ),
              },
              { key: 'note', label: 'Mudança', render: (r) => r.note },
              {
                key: 'createdAt',
                label: 'Criada',
                width: '160px',
                render: (r) => <Timestamp value={r.createdAt} format="relative" />,
              },
              {
                key: 'sizeKb',
                label: 'Tamanho',
                align: 'right',
                width: '110px',
                render: (r) => `${r.sizeKb} KB`,
              },
            ]}
            rowActions={(r) => (
              <Button size="sm" variant="ghost">
                {r.current ? 'Baixar' : 'Comparar'}
              </Button>
            )}
          />
        </Card.Body>
      </Card>
    </div>
  );
}

function Payload({ skill }: { skill: CatalogSkill }) {
  const files = payloadOf(skill);

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
      <Card>
        <Card.Header>
          <Card.Title>Conteúdo do pacote</Card.Title>
          <Card.Description>
            Validado na fronteira: limites de itens, tamanho, ratio e profundidade, sem traversal nem
            symlink, com secret scan.
          </Card.Description>
        </Card.Header>
        <Card.Body>
          <ul className="space-y-2 text-sm">
            {files.map((f) => (
              <li key={f.path} className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  {f.path.endsWith('.md') ? (
                    <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  ) : (
                    <FileArchive className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  )}
                  <span className="truncate font-mono text-xs">{f.path}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(f.bytes)}</span>
              </li>
            ))}
          </ul>
        </Card.Body>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title>SKILL.md</Card.Title>
          <Card.Description>Frontmatter no formato Theokit — o que o parser de M1 exige.</Card.Description>
        </Card.Header>
        <Card.Body>
          <CodeBlock code={skillMarkdown(skill)} language="markdown" copyable />
        </Card.Body>
      </Card>
    </div>
  );
}

function Deliveries({ skill }: { skill: CatalogSkill }) {
  const deliveries = deliveriesOf(skill);

  return (
    <div className="space-y-4">
      <Alert
        intent="info"
        title="Entrega at-least-once, com assinatura e backoff"
        description="Toda conclusão de operação dispara o webhook. Falha transitória entra em retry exponencial com jitter; violação de regra de negócio não entra em retry."
      />
      <Card>
        <Card.Body className="p-0">
          <DataTable<Delivery>
            data={deliveries}
            rowKey={(d) => `${d.eventType}-${d.at}-${d.attempt}`}
            columns={[
              {
                key: 'eventType',
                label: 'Evento',
                width: '170px',
                render: (d) => <span className="font-mono text-xs">{d.eventType}</span>,
              },
              {
                key: 'endpoint',
                label: 'Endpoint',
                render: (d) => <span className="font-mono text-xs">{d.endpoint}</span>,
              },
              { key: 'attempt', label: 'Tentativa', align: 'center', width: '110px', render: (d) => d.attempt },
              {
                key: 'status',
                label: 'Status',
                align: 'right',
                width: '110px',
                render: (d) =>
                  d.status === 200 ? (
                    <Badge variant="success" size="sm">
                      200
                    </Badge>
                  ) : (
                    <Badge variant="destructive" size="sm">
                      {d.status}
                    </Badge>
                  ),
              },
              {
                key: 'at',
                label: 'Quando',
                width: '150px',
                render: (d) => <Timestamp value={d.at} format="relative" />,
              },
            ]}
          />
        </Card.Body>
      </Card>
    </div>
  );
}

export function SkillDetail({ skill, onBack }: { skill: CatalogSkill; onBack: () => void }) {
  const current = revisionsOf(skill)[0]!;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Voltar ao catálogo
      </Button>

      {/* Cabeçalho: quem é a skill, em que estado, e a ação dominante. */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <Avatar size="lg" tone={toneFor(skill.skillId)}>
            <Avatar.Fallback>{initials(skill.displayName)}</Avatar.Fallback>
          </Avatar>
          <div>
            <h2 className="text-2xl font-medium">{skill.displayName}</h2>
            <p className="font-mono text-sm text-muted-foreground">{skill.skillId}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusDot status="live" size="sm" label="ACTIVE" />
              <Badge variant="primary" size="sm">
                rev {current.id}
              </Badge>
              <span className="text-xs text-muted-foreground">
                atualizada <Timestamp value={current.createdAt} format="relative" />
              </span>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary">Baixar payload</Button>
          <Button>Copiar comando CLI</Button>
        </div>
      </div>

      <Alert
        intent="warning"
        title="Três coisas desta tela dependem de milestone aberto"
        description={
          <ul className="list-disc space-y-1 pl-4">
            {DETAIL_GAPS.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        }
      />

      <Tabs defaultValue="overview">
        <Tabs.List>
          <Tabs.Trigger value="overview">Visão geral</Tabs.Trigger>
          <Tabs.Trigger value="revisions">Revisões</Tabs.Trigger>
          <Tabs.Trigger value="payload">Payload</Tabs.Trigger>
          <Tabs.Trigger value="deliveries">Entrega</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="overview" className="pt-6">
          <Overview skill={skill} />
        </Tabs.Content>
        <Tabs.Content value="revisions" className="pt-6">
          <Revisions skill={skill} />
        </Tabs.Content>
        <Tabs.Content value="payload" className="pt-6">
          <Payload skill={skill} />
        </Tabs.Content>
        <Tabs.Content value="deliveries" className="pt-6">
          <Deliveries skill={skill} />
        </Tabs.Content>
      </Tabs>

      {/* Coreografia destrutiva do DESIGN.md § 2.2: zona isolada, nunca botão primário. */}
      <DangerZone>
        <DangerZone.Action
          title="Deletar esta skill"
          description="A operação é assíncrona e o skillId continua reservado depois — ninguém pode republicar com o mesmo nome dentro da janela configurada. Agentes que resolvem esta skill em runtime param de encontrá-la."
          action={<Button variant="destructive">Deletar skill</Button>}
        />
      </DangerZone>
    </div>
  );
}
