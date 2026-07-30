import { Alert, Avatar, Badge, Button, Card, EmptyState, Input } from '@usetheo/ui';
import { FileArchive, Search, SlidersHorizontal } from 'lucide-react';
import { useMemo, useState } from 'react';

import { CATALOG, CATALOG_GAPS, tagCounts, type CatalogSkill } from './data/catalog';
import { initials, toneFor } from './lib/skill-visuals';

type Sort = 'relevance' | 'name' | 'recent';

function SkillCard({
  skill,
  showScore,
  onOpen,
}: {
  skill: CatalogSkill;
  showScore: boolean;
  onOpen: () => void;
}) {
  return (
    <Card
      className="flex h-full cursor-pointer flex-col transition-colors hover:border-primary/50 focus-visible:border-primary"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      aria-label={`Abrir ${skill.displayName}`}
    >
      <Card.Header>
        <div className="flex items-start gap-3">
          <Avatar size="md" tone={toneFor(skill.skillId)}>
            <Avatar.Fallback>{initials(skill.displayName)}</Avatar.Fallback>
          </Avatar>
          <div className="min-w-0">
            <Card.Title className="truncate text-base">{skill.displayName}</Card.Title>
            <Card.Description className="font-mono text-xs">{skill.skillId}</Card.Description>
          </div>
        </div>
      </Card.Header>

      <Card.Body className="flex flex-1 flex-col gap-3">
        <p className="line-clamp-3 text-sm text-muted-foreground">{skill.description}</p>

        <div className="mt-auto flex flex-wrap gap-1.5">
          {skill.tags.map((t) => (
            <Badge key={t} variant="outline" size="sm">
              {t}
            </Badge>
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-3">
            <span>rev {skill.revision}</span>
            {skill.hasBundle && (
              <span className="flex items-center gap-1">
                <FileArchive className="size-3.5" aria-hidden="true" />
                {skill.sizeKb} KB
              </span>
            )}
          </span>
          {showScore && <Badge variant="primary" size="sm">{skill.score.toFixed(2)}</Badge>}
        </div>
      </Card.Body>
    </Card>
  );
}

export function SkillCatalog({ onOpen }: { onOpen: (skill: CatalogSkill) => void }) {
  const [query, setQuery] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>('relevance');
  const [allTags, setAllTags] = useState(false);

  const tags = useMemo(() => tagCounts(CATALOG), []);
  /** 25 pills em duas linhas viram ruído; a galeria de referência mostra ~8 + "mais". */
  const visibleTags = allTags ? tags : tags.slice(0, 8);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = CATALOG.filter((s) => {
      const matchesTag = activeTag === null || s.tags.includes(activeTag);
      const matchesQuery =
        q === '' ||
        s.displayName.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.skillId.includes(q) ||
        s.tags.some((t) => t.includes(q));
      return matchesTag && matchesQuery;
    });

    const sorted = [...filtered];
    if (sort === 'name') sorted.sort((a, b) => a.displayName.localeCompare(b.displayName));
    else if (sort === 'recent') sorted.sort((a, b) => b.revision - a.revision);
    else sorted.sort((a, b) => b.score - a.score);
    return sorted;
  }, [query, activeTag, sort]);

  return (
    <div className="space-y-6">
      <Alert
        intent="warning"
        title="Esta tela mostra quatro coisas que o backend ainda não entrega"
        description={
          <ul className="list-disc space-y-1 pl-4">
            {CATALOG_GAPS.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        }
      />

      {/* Busca — o diferencial é a intenção, não o nome exato. */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-64 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            className="pl-9"
            placeholder="preciso mexer em recursos de nuvem…"
            aria-label="Buscar skills por intenção"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="size-4 text-muted-foreground" aria-hidden="true" />
          {(
            [
              ['relevance', 'Relevância'],
              ['name', 'Nome'],
              ['recent', 'Revisão'],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              size="sm"
              variant={sort === value ? 'secondary' : 'ghost'}
              onClick={() => setSort(value)}
              aria-pressed={sort === value}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      {/* Filtro por tag — pills com contagem, como na galeria de referência. */}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={activeTag === null ? 'secondary' : 'ghost'}
          onClick={() => setActiveTag(null)}
          aria-pressed={activeTag === null}
        >
          Todas <span className="ml-1.5 text-muted-foreground">{CATALOG.length}</span>
        </Button>
        {visibleTags.map(({ tag, count }) => (
          <Button
            key={tag}
            size="sm"
            variant={activeTag === tag ? 'secondary' : 'ghost'}
            onClick={() => setActiveTag(activeTag === tag ? null : tag)}
            aria-pressed={activeTag === tag}
          >
            {tag} <span className="ml-1.5 text-muted-foreground">{count}</span>
          </Button>
        ))}
        {tags.length > 8 && (
          <Button size="sm" variant="link" onClick={() => setAllTags((v) => !v)}>
            {allTags ? 'menos tags' : `mais ${tags.length - 8} tags`}
          </Button>
        )}
      </div>

      <div className="flex items-baseline justify-between gap-4">
        <h3 className="text-lg font-medium">
          Skills <span className="text-muted-foreground">({results.length})</span>
        </h3>
        {query.trim() !== '' && (
          <span className="text-xs text-muted-foreground">
            score do retrieve híbrido · keyword (FTS) + vetor (pgvector)
          </span>
        )}
      </div>

      {results.length === 0 ? (
        <EmptyState
          icon={Search}
          title="Nenhuma skill para esta busca"
          description="Tente outra intenção, ou limpe o filtro de tag. Numa instância real, este é o momento de sugerir publicar a skill que falta."
          action={
            <Button
              onClick={() => {
                setQuery('');
                setActiveTag(null);
              }}
            >
              Limpar filtros
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {results.map((s) => (
            <SkillCard
              key={s.skillId}
              skill={s}
              showScore={query.trim() !== ''}
              onOpen={() => onOpen(s)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
