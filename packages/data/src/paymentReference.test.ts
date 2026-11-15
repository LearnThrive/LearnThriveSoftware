import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { SqlLibraryStore } from "./library";
import { getDataProvider, resetDataProvider } from "./inMemoryProvider";
import {
  generatePaymentReference, isPaymentReference, PAYMENT_REFERENCE_ALPHABET, PAYMENT_REFERENCE_PATTERN,
} from "./paymentReference";
import { createSqlDataProvider } from "./sqlProvider";
import { createTestDb, type TestDb } from "./testing/pglite";

// A family's payment reference: LT- and six characters from an unambiguous alphabet, random (no personal data), made once, unique, never changed.

test("the format: LT- and six characters, none of 0, O, 1 or I", () => {
  assert.equal(PAYMENT_REFERENCE_ALPHABET.length, 32, "a power of two: no modulo bias in the draw");
  assert.equal(new Set(PAYMENT_REFERENCE_ALPHABET).size, 32);
  for (const ambiguous of ["0", "O", "1", "I"]) assert.ok(!PAYMENT_REFERENCE_ALPHABET.includes(ambiguous), `${ambiguous} is left out`);
  assert.match(PAYMENT_REFERENCE_ALPHABET, /^[A-Z2-9]+$/);
  for (let i = 0; i < 2000; i += 1) {
    const reference = generatePaymentReference();
    assert.match(reference, /^LT-[A-Z2-9]{6}$/);
    assert.ok(isPaymentReference(reference));
    assert.doesNotMatch(reference.slice(3), /[01OI]/);
  }
  for (const bad of ["LT-ABC12", "LT-ABCDEFG", "lt-ABCDEF", "LT-ABCD0F", "LT-ABCDOF", "LT-ABCD1F", "LT-ABCDIF", "XX-ABCDEF", "LTABCDEF", "LT-ABC DE", "", null, 5]) {
    assert.equal(isPaymentReference(bad), false, String(bad));
  }
});

test("it is random and carries nothing about the family: the draw takes no input, and a fixed source gives a fixed answer", () => {
  assert.equal(generatePaymentReference(() => 0), "LT-AAAAAA");
  assert.equal(generatePaymentReference((max) => max - 1), "LT-999999");
  const seen = new Set(Array.from({ length: 3000 }, () => generatePaymentReference()));
  assert.ok(seen.size > 2990, "draws differ");
  // Every character of the alphabet turns up: nothing about the draw favours a few letters.
  const used = new Set([...seen].flatMap((r) => [...r.slice(3)]));
  assert.equal(used.size, 32);
});

describe("in memory", () => {
  test("a family's reference is made on first use, is the same afterwards, and differs between families", async () => {
    resetDataProvider();
    const data = getDataProvider();
    const families = await data.clients.list();
    const first = await data.clients.ensurePaymentReference(families[0]!.id);
    assert.match(first!, PAYMENT_REFERENCE_PATTERN);
    for (let i = 0; i < 5; i += 1) assert.equal(await data.clients.ensurePaymentReference(families[0]!.id), first, "stable");
    const more = await Promise.all(Array.from({ length: 40 }, (_, i) => data.clients.create({ name: `Family ${i}`, email: `f${i}@example.test`, active: true })));
    const references = [first, ...(await Promise.all(more.map((c) => data.clients.ensurePaymentReference(c.id))))];
    assert.equal(new Set(references).size, references.length, "unique");
  });

  test("no such family has no reference; and nothing a form can send sets it: it is not on the record and update() ignores it", async () => {
    resetDataProvider();
    const data = getDataProvider();
    assert.equal(await data.clients.ensurePaymentReference("no-such-family"), null);
    const [family] = await data.clients.list();
    const reference = (await data.clients.ensurePaymentReference(family!.id))!;
    assert.ok(!JSON.stringify(family).includes(reference), "the client record does not carry it");
    await data.clients.update(family!.id, { paymentReference: "LT-AAAAAA" } as never);
    assert.equal(await data.clients.ensurePaymentReference(family!.id), reference, "an update cannot change it");
  });
});

describe("in the database (migration 0026, on PGlite)", () => {
  let db: TestDb;
  before(async () => {
    db = await createTestDb();
  });
  after(() => db.close());

  const owner = <T = Record<string, any>>(sql: string, params?: unknown[]) => db.asOwner((q) => q.query<T>(sql, params));
  const executor = { query: <T = Record<string, any>>(sql: string, params?: unknown[]) => owner<T>(sql, params) };
  const newFamily = async (name: string) => {
    const store = new SqlLibraryStore(executor);
    const guardian = await db.createUser({ displayName: name, adult: true });
    return { guardian, clientId: await store.accounts.ensureClient(guardian) };
  };

  test("made on first use, stable, unique across many families, and in the right format", async () => {
    const data = createSqlDataProvider(executor);
    const families = [];
    for (let i = 0; i < 25; i += 1) families.push(await newFamily(`Parent ${i}`));
    const references = [];
    for (const f of families) references.push((await data.clients.ensurePaymentReference(f.clientId))!);
    for (const reference of references) assert.match(reference, PAYMENT_REFERENCE_PATTERN);
    assert.equal(new Set(references).size, references.length, "unique");
    for (let i = 0; i < families.length; i += 1) assert.equal(await data.clients.ensurePaymentReference(families[i]!.clientId), references[i], "stable");
    assert.equal(await data.clients.ensurePaymentReference("not-a-uuid"), null);
    assert.equal(await data.clients.ensurePaymentReference("00000000-0000-4000-8000-000000000000"), null);
  });

  test("the database itself refuses a duplicate, a badly formed reference, and any change once set", async () => {
    const data = createSqlDataProvider(executor);
    const a = await newFamily("A");
    const b = await newFamily("B");
    const referenceA = (await data.clients.ensurePaymentReference(a.clientId))!;
    await assert.rejects(() => owner(`update public.clients set payment_reference = $2 where id = $1`, [b.clientId, referenceA]), /unique|duplicate/i, "two families cannot share one");
    for (const bad of ["LT-ABCD0F", "LT-ABCDOF", "LT-ABCDEF1", "lt-abcdef", "LT-ABCDEI"]) {
      await assert.rejects(() => owner(`update public.clients set payment_reference = $2 where id = $1`, [b.clientId, bad]), /check|violat/i, bad);
    }
    await assert.rejects(() => owner(`update public.clients set payment_reference = 'LT-ABCDEF' where id = $1`, [a.clientId]), /never changes/, "no change once it is made");
    await assert.rejects(() => owner(`update public.clients set payment_reference = null where id = $1`, [a.clientId]), /never changes/, "nor removal");
    assert.equal(await data.clients.ensurePaymentReference(a.clientId), referenceA);
    // Setting it once on a family that has none is the one allowed write.
    await owner(`update public.clients set payment_reference = 'LT-ABCDEF' where id = $1`, [b.clientId]);
    assert.equal(await data.clients.ensurePaymentReference(b.clientId), "LT-ABCDEF");
  });

  test("a signed-in family cannot write its own reference (no update right on clients), and reads only its own", async () => {
    const data = createSqlDataProvider(executor);
    const a = await newFamily("Own A");
    const b = await newFamily("Own B");
    const referenceA = (await data.clients.ensurePaymentReference(a.clientId))!;
    const referenceB = (await data.clients.ensurePaymentReference(b.clientId))!;
    await assert.rejects(() => db.asUser(a.guardian, (q) => q.query(`update public.clients set payment_reference = 'LT-ZZZZZZ' where id = $1`, [a.clientId])), /permission denied/i);
    const seen = await db.asUser(a.guardian, (q) => q.query<{ payment_reference: string }>(`select payment_reference from public.clients`));
    assert.deepEqual(seen.map((r) => r.payment_reference), [referenceA], "their own row only");
    assert.ok(!seen.some((r) => r.payment_reference === referenceB));
  });
});
