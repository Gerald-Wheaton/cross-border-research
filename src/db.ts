import postgres from "postgres";
import type { ReviewRuleRow, RuleRow, TargetField } from "./types";
import type { AppConfig } from "./config";

interface ExistingAiValueRow {
  value: string | null;
}

export interface Database {
  ensureRuleAiGenerationTable(): Promise<void>;
  fetchRulesForReview(): Promise<ReviewRuleRow[]>;
  fetchSourceRules(ruleIds?: string[] | null): Promise<RuleRow[]>;
  syncAiRowFromSource(ruleId: string): Promise<void>;
  ensureAiRowFromSource(ruleId: string): Promise<void>;
  getExistingAiValue(ruleId: string, fieldName: TargetField): Promise<string | null>;
  updateAiField(ruleId: string, fieldName: TargetField, fieldValue: string): Promise<void>;
  close(): Promise<void>;
}

export function createDatabase(config: AppConfig): Database {
  const sql = postgres(config.databaseUrl, {
    max: config.dbMaxConnections,
    idle_timeout: 20,
  });

  async function ensureRuleAiGenerationTable(): Promise<void> {
    await sql`
      create table if not exists public.rule_ai_generation
      (like public.rule including defaults including constraints including indexes)
    `;
  }

  async function fetchRulesForReview(): Promise<ReviewRuleRow[]> {
    return sql<ReviewRuleRow[]>`
      select
        r.rule_id,
        r.name,
        r.jurisdiction_id,
        r.section,
        r.category,
        r.logic_category,
        r.verification_status,
        r.last_verified::text as last_verified,
        r.trigger_condition as original_trigger_condition,
        r.legal_source as original_legal_source,
        r.edge_cases as original_edge_cases,
        aig.trigger_condition as ai_trigger_condition,
        aig.legal_source as ai_legal_source,
        aig.edge_cases as ai_edge_cases,
        aig.last_verified::text as ai_last_verified,
        aig.verification_status as ai_verification_status
      from public.rule r
      left join public.rule_ai_generation aig on aig.rule_id = r.rule_id
      where r.jurisdiction_id <> 'CROSS'
      order by r.jurisdiction_id, r.rule_id
    `;
  }

  async function fetchSourceRules(ruleIds?: string[] | null): Promise<RuleRow[]> {
    if (Array.isArray(ruleIds) && ruleIds.length > 0) {
      return sql<RuleRow[]>`
        select
          rule_id,
          name,
          jurisdiction_id,
          section,
          category,
          trigger_condition,
          calculation_outcome,
          legal_source,
          edge_cases,
          notes_for_platform,
          last_verified::text as last_verified,
          verification_status,
          logic_category
        from public.rule
        where jurisdiction_id <> 'CROSS'
          and rule_id = any(${sql.array(ruleIds)})
        order by jurisdiction_id, rule_id
      `;
    }

    return sql<RuleRow[]>`
      select
        rule_id,
        name,
        jurisdiction_id,
        section,
        category,
        trigger_condition,
        calculation_outcome,
        legal_source,
        edge_cases,
        notes_for_platform,
        last_verified::text as last_verified,
        verification_status,
        logic_category
      from public.rule
      where jurisdiction_id <> 'CROSS'
      order by jurisdiction_id, rule_id
    `;
  }

  async function syncAiRowFromSource(ruleId: string): Promise<void> {
    await sql`
      insert into public.rule_ai_generation (
        rule_id,
        name,
        jurisdiction_id,
        section,
        category,
        trigger_condition,
        calculation_outcome,
        legal_source,
        edge_cases,
        notes_for_platform,
        last_verified,
        verification_status,
        logic_category
      )
      select
        rule_id,
        name,
        jurisdiction_id,
        section,
        category,
        trigger_condition,
        calculation_outcome,
        legal_source,
        edge_cases,
        notes_for_platform,
        last_verified,
        verification_status,
        logic_category
      from public.rule
      where rule_id = ${ruleId}
      on conflict (rule_id) do update
      set
        name = excluded.name,
        jurisdiction_id = excluded.jurisdiction_id,
        section = excluded.section,
        category = excluded.category,
        trigger_condition = excluded.trigger_condition,
        calculation_outcome = excluded.calculation_outcome,
        legal_source = excluded.legal_source,
        edge_cases = excluded.edge_cases,
        notes_for_platform = excluded.notes_for_platform,
        last_verified = excluded.last_verified,
        verification_status = excluded.verification_status,
        logic_category = excluded.logic_category
    `;
  }

  async function ensureAiRowFromSource(ruleId: string): Promise<void> {
    await sql`
      insert into public.rule_ai_generation (
        rule_id,
        name,
        jurisdiction_id,
        section,
        category,
        trigger_condition,
        calculation_outcome,
        legal_source,
        edge_cases,
        notes_for_platform,
        last_verified,
        verification_status,
        logic_category
      )
      select
        rule_id,
        name,
        jurisdiction_id,
        section,
        category,
        null::text as trigger_condition,
        calculation_outcome,
        null::text as legal_source,
        null::text as edge_cases,
        notes_for_platform,
        last_verified,
        verification_status,
        logic_category
      from public.rule
      where rule_id = ${ruleId}
      on conflict (rule_id) do update
      set
        name = excluded.name,
        jurisdiction_id = excluded.jurisdiction_id,
        section = excluded.section,
        category = excluded.category,
        calculation_outcome = excluded.calculation_outcome,
        notes_for_platform = excluded.notes_for_platform,
        logic_category = excluded.logic_category
    `;
  }

  async function getExistingAiValue(ruleId: string, fieldName: TargetField): Promise<string | null> {
    const fieldIdentifier = sql(fieldName);
    const rows = await sql<ExistingAiValueRow[]>`
      select ${fieldIdentifier} as value
      from public.rule_ai_generation
      where rule_id = ${ruleId}
    `;
    return rows[0]?.value ?? null;
  }

  async function updateAiField(ruleId: string, fieldName: TargetField, fieldValue: string): Promise<void> {
    const fieldIdentifier = sql(fieldName);
    await sql`
      update public.rule_ai_generation
      set
        ${fieldIdentifier} = ${fieldValue},
        verification_status = 'AI_REVIEWED',
        last_verified = current_date
      where rule_id = ${ruleId}
    `;
  }

  async function close(): Promise<void> {
    await sql.end({ timeout: 5 });
  }

  return {
    ensureRuleAiGenerationTable,
    fetchRulesForReview,
    fetchSourceRules,
    syncAiRowFromSource,
    ensureAiRowFromSource,
    getExistingAiValue,
    updateAiField,
    close,
  };
}
