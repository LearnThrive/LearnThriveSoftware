import Link from "next/link";
import { LEVELS, RESOURCE_TYPES, type Resource, type ResourceFacets, type ResourcePage } from "@learnthrive/data/library";
import { PAGE_SIZE, catalogueHref, nameSlug, type CatalogueQuery } from "@/lib/library/catalogue";
import styles from "./catalogue.module.css";

/**
 * Browse and search (plan19 phase D): a GET form, so it works without JavaScript and every view has an address, a
 * result list, and previous / next links. Server-rendered, no client code. Titles, descriptions and a few facts are
 * shown; a file is never linked from here, only the resource's own page offers the (gated) download.
 */
export function ResourceCard({ resource }: { resource: Resource }) {
  return (
    <li className={styles.card}>
      <article aria-labelledby={`r-${resource.slug}`}>
        <h3 id={`r-${resource.slug}`} className={styles.cardTitle}>
          <Link href={`/library/${resource.slug}`}>{resource.title}</Link>
        </h3>
        <p className={styles.meta}>
          <span>{resource.subject}</span>
          <span>{resource.level}</span>
          <span>{resource.resourceType}</span>
          <span>{resource.topic}</span>
        </p>
        {resource.description ? <p className={styles.description}>{resource.description}</p> : null}
        <p className={styles.tier}>{resource.accessTier === "free_sample" ? "Free sample" : "Included for enrolled students and members"}</p>
      </article>
    </li>
  );
}

export function CatalogueView({
  path,
  query,
  facets,
  results,
  fixedSubject,
  heading,
}: {
  /** The page this view lives on (the form submits back to it). */
  path: string;
  query: CatalogueQuery;
  facets: ResourceFacets;
  results: ResourcePage;
  /** On a subject page the subject is part of the address, not a field. */
  fixedSubject?: string;
  heading: string;
}) {
  const pages = Math.max(1, Math.ceil(results.total / PAGE_SIZE));
  const base = { ...query, page: 1 };
  const hasFilters = Boolean(query.q || query.level || query.type || query.topic || (!fixedSubject && query.subject));
  const pastTheEnd = results.total > 0 && results.items.length === 0;
  const summary =
    results.total === 0
      ? "No resources match."
      : pastTheEnd
        ? `${results.total} ${results.total === 1 ? "resource" : "resources"}, but there is no page ${query.page}.`
        : `${results.total} ${results.total === 1 ? "resource" : "resources"}${pages > 1 ? `, page ${query.page} of ${pages}` : ""}.`;

  return (
    <section className={styles.catalogue} aria-labelledby="catalogue-heading" id="catalogue">
      <h2 id="catalogue-heading">{heading}</h2>
      <form method="get" action={path} role="search" aria-label="Search the Library" className={styles.filters}>
        <div className={styles.field}>
          <label htmlFor="cat-q">Search</label>
          <input id="cat-q" name="q" type="search" defaultValue={query.q} maxLength={100} autoComplete="off" enterKeyHint="search" />
        </div>
        {fixedSubject ? null : (
          <div className={styles.field}>
            <label htmlFor="cat-subject">Subject</label>
            <select id="cat-subject" name="subject" defaultValue={query.subject}>
              <option value="">All subjects</option>
              {facets.subjects.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.value}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className={styles.field}>
          <label htmlFor="cat-level">Level</label>
          <select id="cat-level" name="level" defaultValue={query.level}>
            <option value="">All levels</option>
            {LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor="cat-type">Type</label>
          <select id="cat-type" name="type" defaultValue={query.type}>
            <option value="">All types</option>
            {RESOURCE_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.actions}>
          <button type="submit" className="button button--primary">
            <span>Search</span>
          </button>
          {hasFilters ? (
            <Link className={styles.clear} href={fixedSubject ? path : "/library#catalogue"}>
              Clear filters
            </Link>
          ) : null}
        </div>
      </form>

      <p className={styles.summary} role="status">
        {summary}
      </p>

      {results.items.length > 0 ? (
        <ul className={styles.list} aria-label="Resources">
          {results.items.map((resource) => (
            <ResourceCard key={resource.id} resource={resource} />
          ))}
        </ul>
      ) : pastTheEnd ? (
        <p className={styles.empty}>
          <Link href={`${catalogueHref(path, base)}#catalogue`}>Go to the first page</Link>
        </p>
      ) : (
        <p className={styles.empty}>Try fewer words, or clear the filters.</p>
      )}

      {pages > 1 ? (
        <nav className={styles.pager} aria-label="Pages of results">
          {query.page > 1 ? (
            <Link rel="prev" href={`${catalogueHref(path, { ...base, page: query.page - 1 })}#catalogue`}>
              Previous page
            </Link>
          ) : (
            <span aria-hidden="true" />
          )}
          {query.page < pages ? (
            <Link rel="next" href={`${catalogueHref(path, { ...base, page: query.page + 1 })}#catalogue`}>
              Next page
            </Link>
          ) : null}
        </nav>
      ) : null}

      {facets.subjects.length > 0 && !fixedSubject ? (
        <nav aria-label="Browse by subject" className={styles.subjects}>
          <h3>Browse by subject</h3>
          <ul>
            {facets.subjects.map((f) => (
              <li key={f.value}>
                <Link href={`/library/subject/${nameSlug(f.value)}`}>
                  {f.value} <span className={styles.count}>({f.count})</span>
                </Link>
              </li>
            ))}
            <li>
              <Link href="/library/free-samples">Free samples</Link>
            </li>
          </ul>
        </nav>
      ) : null}
    </section>
  );
}
