"use client";

import type { ComponentType } from "react";
import { createLibrary } from "@openuidev/react-lang";
import { COMPONENT_GROUPS, COMPONENTS, LIBRARY_ID, ROOT } from "@/lib/openui/schemas";
import * as general from "./general";
import * as maths from "./maths";
import * as science from "./science";
import * as english from "./english";
import * as revision from "./revision";

/**
 * The library as the PAGE draws it: the same component definitions the server taught the model and validated against (lib/openui/schemas.ts), each with
 * the component that draws it. A part (a GraphFunction, a Step) is data its parent reads, never drawn on its own, so its renderer draws nothing. A name that
 * is not in this table cannot be drawn; the parser drops it.
 */
// The renderers take loosely-typed props on purpose: the parser has already shaped them to each component's schema, and a stored interface from an older
// library version must still draw, so each component reads what it is given defensively.
type Draw = ComponentType<{ props: Record<string, unknown>; renderNode: (value: unknown) => React.ReactNode }>;

const nothing: Draw = () => null;

const RENDERERS: Record<string, Draw> = {
  Answer: general.Answer,
  Heading: general.Heading,
  Text: general.Text,
  Callout: general.Callout,
  Card: general.Card,
  Tabs: general.Tabs,
  Accordion: general.Accordion,
  DataTable: general.DataTable,
  Comparison: general.Comparison,
  Timeline: general.Timeline,
  Steps: general.Steps,
  Checklist: general.Checklist,
  FollowUps: general.FollowUps,
  KnowledgeOrganiser: general.KnowledgeOrganiser,
  AOFeedback: general.AOFeedback,
  Equation: maths.Equation,
  SolutionSteps: maths.SolutionSteps,
  Slider: maths.Slider,
  FunctionGraph: maths.FunctionGraph,
  NumberLine: maths.NumberLine,
  Triangle: maths.Triangle,
  DataChart: maths.DataChart,
  ProbabilityTree: maths.ProbabilityTree,
  ProcessDiagram: science.ProcessDiagram,
  Reaction: science.Reaction,
  QuoteCard: english.QuoteCard,
  Quiz: revision.Quiz,
  Flashcards: revision.Flashcards,
  OpenResponse: revision.OpenResponse,
};

export const library = createLibrary({
  id: LIBRARY_ID,
  root: ROOT,
  components: COMPONENTS.map((definition) => ({ ...definition, component: RENDERERS[definition.name] ?? nothing })) as never,
  componentGroups: COMPONENT_GROUPS,
});

/** For the test that proves every component has a renderer or is deliberately a part. */
export const DRAWN: ReadonlySet<string> = new Set(Object.keys(RENDERERS));
