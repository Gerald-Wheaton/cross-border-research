import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { max: 1 });

function slugifyCategory(label) {
  return label
    .toLowerCase()
    .replace(/\s*\/\s*/g, "-")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function main() {
  const mode = process.argv[2] || "overview";

  try {
    if (mode === "overview") {
      const [info] = await sql`
        select
          current_database() as db,
          current_user as user,
          version() as version
      `;

      const schemas = await sql`
        select schema_name
        from information_schema.schemata
        where schema_name not in ('pg_catalog', 'information_schema')
        order by schema_name
      `;

      const tables = await sql`
        select table_schema, table_name
        from information_schema.tables
        where table_type = 'BASE TABLE'
          and table_schema not in ('pg_catalog', 'information_schema')
        order by table_schema, table_name
      `;

      console.log(JSON.stringify({ info, schemas, tables }, null, 2));
      return;
    }

    if (mode === "columns") {
      const rows = await sql`
        select
          table_schema,
          table_name,
          column_name,
          data_type,
          is_nullable,
          column_default
        from information_schema.columns
        where table_schema not in ('pg_catalog', 'information_schema')
        order by table_schema, table_name, ordinal_position
      `;

      console.log(JSON.stringify(rows, null, 2));
      return;
    }

    if (mode === "constraints") {
      const rows = await sql`
        select
          tc.table_schema,
          tc.table_name,
          tc.constraint_name,
          tc.constraint_type,
          kcu.column_name,
          ccu.table_schema as foreign_table_schema,
          ccu.table_name as foreign_table_name,
          ccu.column_name as foreign_column_name
        from information_schema.table_constraints tc
        left join information_schema.key_column_usage kcu
          on tc.constraint_name = kcu.constraint_name
         and tc.table_schema = kcu.table_schema
         and tc.table_name = kcu.table_name
        left join information_schema.constraint_column_usage ccu
          on tc.constraint_name = ccu.constraint_name
         and tc.table_schema = ccu.table_schema
        where tc.table_schema not in ('pg_catalog', 'information_schema')
        order by tc.table_schema, tc.table_name, tc.constraint_type, tc.constraint_name, kcu.ordinal_position
      `;

      console.log(JSON.stringify(rows, null, 2));
      return;
    }

    if (mode === "counts") {
      const tables = await sql`
        select table_schema, table_name
        from information_schema.tables
        where table_type = 'BASE TABLE'
          and table_schema not in ('pg_catalog', 'information_schema')
        order by table_schema, table_name
      `;

      const counts = [];
      for (const table of tables) {
        const identifier = sql(`${table.table_schema}.${table.table_name}`);
        const [{ count }] = await sql`select count(*)::int as count from ${identifier}`;
        counts.push({ ...table, count });
      }

      console.log(JSON.stringify(counts, null, 2));
      return;
    }

    if (mode === "summary") {
      const jurisdictions = await sql`
        select jurisdiction_id, name, code
        from public.jurisdiction
        order by code
      `;

      const statuses = await sql`
        select status_code, label, sort_order
        from public.verification_status
        order by sort_order
      `;

      const ruleStats = await sql`
        select
          count(*)::int as total_rules,
          count(*) filter (where trigger_condition is not null)::int as rules_with_trigger_condition,
          count(*) filter (where calculation_outcome is not null)::int as rules_with_calculation_outcome,
          count(*) filter (where legal_source is not null)::int as rules_with_legal_source,
          count(*) filter (where edge_cases is not null)::int as rules_with_edge_cases,
          count(*) filter (where notes_for_platform is not null)::int as rules_with_notes_for_platform,
          count(*) filter (where last_verified is not null)::int as rules_with_last_verified
        from public.rule
      `;

      const categories = await sql`
        select category, count(*)::int as count
        from public.rule
        group by category
        order by count desc, category
      `;

      const logicCategories = await sql`
        select logic_category, count(*)::int as count
        from public.rule
        group by logic_category
        order by logic_category nulls last
      `;

      const verificationBreakdown = await sql`
        select verification_status, count(*)::int as count
        from public.rule
        group by verification_status
        order by verification_status
      `;

      const interactionTypes = await sql`
        select interaction_type, count(*)::int as count
        from public.rule_interaction
        group by interaction_type
        order by count desc, interaction_type
      `;

      console.log(
        JSON.stringify(
          {
            jurisdictions,
            statuses,
            ruleStats: ruleStats[0],
            categories,
            logicCategories,
            verificationBreakdown,
            interactionTypes,
          },
          null,
          2,
        ),
      );
      return;
    }

    if (mode === "checks") {
      const rows = await sql`
        select
          n.nspname as table_schema,
          c.relname as table_name,
          con.conname as constraint_name,
          pg_get_constraintdef(con.oid) as definition
        from pg_constraint con
        join pg_class c on c.oid = con.conrelid
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname not in ('pg_catalog', 'information_schema')
          and con.contype = 'c'
        order by n.nspname, c.relname, con.conname
      `;

      console.log(JSON.stringify(rows, null, 2));
      return;
    }

    if (mode === "samples") {
      const rules = await sql`
        select
          rule_id,
          name,
          jurisdiction_id,
          section,
          category,
          logic_category,
          verification_status
        from public.rule
        order by jurisdiction_id, rule_id
        limit 12
      `;

      console.log(JSON.stringify({ rules }, null, 2));
      return;
    }

    if (mode === "create-category-table") {
      const result = await sql.begin(async (tx) => {
        await tx`
          create table if not exists public.category (
            category_code varchar primary key,
            label varchar not null,
            description text not null,
            sort_order smallint not null unique
          )
        `;

        await tx`
          insert into public.category (category_code, label, description, sort_order)
          select
            category,
            category,
            category,
            row_number() over (order by category)::smallint
          from (
            select distinct category
            from public.rule
          ) categories
          on conflict (category_code) do update
          set
            label = excluded.label,
            description = excluded.description
        `;

        const fkExists = await tx`
          select 1
          from information_schema.table_constraints
          where table_schema = 'public'
            and table_name = 'rule'
            and constraint_name = 'rule_category_fkey'
        `;

        if (fkExists.length === 0) {
          await tx`
            alter table public.rule
            add constraint rule_category_fkey
            foreign key (category)
            references public.category(category_code)
          `;
        }

        return tx`
          select category_code, label, description, sort_order
          from public.category
          order by sort_order
        `;
      });

      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (mode === "verify-category-table") {
      const table = await sql`
        select table_name
        from information_schema.tables
        where table_schema = 'public'
          and table_name = 'category'
      `;

      const constraint = await sql`
        select constraint_name
        from information_schema.table_constraints
        where table_schema = 'public'
          and table_name = 'rule'
          and constraint_name = 'rule_category_fkey'
      `;

      console.log(JSON.stringify({ table, constraint }, null, 2));
      return;
    }

    if (mode === "drop-category-description") {
      const result = await sql.begin(async (tx) => {
        const hasColumn = await tx`
          select 1
          from information_schema.columns
          where table_schema = 'public'
            and table_name = 'category'
            and column_name = 'description'
        `;

        if (hasColumn.length > 0) {
          await tx`
            alter table public.category
            drop column description
          `;
        }

        return tx`
          select
            column_name,
            data_type,
            is_nullable
          from information_schema.columns
          where table_schema = 'public'
            and table_name = 'category'
          order by ordinal_position
        `;
      });

      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (mode === "slug-category-codes") {
      const categories = await sql`
        select category_code, label, sort_order
        from public.category
        order by sort_order, category_code
      `;

      const mapping = categories.map((category) => ({
        old_code: category.category_code,
        new_code: slugifyCategory(category.label),
        label: category.label,
        sort_order: category.sort_order,
      }));

      const collisions = mapping.filter(
        (item, index) =>
          mapping.findIndex((other) => other.new_code === item.new_code) !== index,
      );

      const emptySlugs = mapping.filter((item) => !item.new_code);

      if (collisions.length > 0 || emptySlugs.length > 0) {
        console.log(
          JSON.stringify(
            {
              ok: false,
              collisions,
              emptySlugs,
            },
            null,
            2,
          ),
        );
        process.exitCode = 1;
        return;
      }

      const result = await sql.begin(async (tx) => {
        await tx`alter table public.rule drop constraint if exists rule_category_fkey`;

        for (const item of mapping) {
          if (item.old_code === item.new_code) {
            continue;
          }

          await tx`
            update public.category
            set category_code = ${item.new_code}
            where category_code = ${item.old_code}
          `;

          await tx`
            update public.rule
            set category = ${item.new_code}
            where category = ${item.old_code}
          `;
        }

        await tx`
          alter table public.rule
          add constraint rule_category_fkey
          foreign key (category)
          references public.category(category_code)
        `;

        const categoriesAfter = await tx`
          select category_code, label, sort_order
          from public.category
          order by sort_order
        `;

        const orphanRules = await tx`
          select count(*)::int as count
          from public.rule r
          left join public.category c
            on c.category_code = r.category
          where c.category_code is null
        `;

        const foreignKey = await tx`
          select constraint_name
          from information_schema.table_constraints
          where table_schema = 'public'
            and table_name = 'rule'
            and constraint_name = 'rule_category_fkey'
        `;

        return {
          ok: true,
          mapping,
          categoriesAfter,
          orphanRules: orphanRules[0],
          foreignKey,
        };
      });

      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (mode === "restore-category-description") {
      const result = await sql.begin(async (tx) => {
        const hasColumn = await tx`
          select 1
          from information_schema.columns
          where table_schema = 'public'
            and table_name = 'category'
            and column_name = 'description'
        `;

        if (hasColumn.length === 0) {
          await tx`
            alter table public.category
            add column description text
          `;
        }

        return tx`
          select
            column_name,
            data_type,
            is_nullable
          from information_schema.columns
          where table_schema = 'public'
            and table_name = 'category'
          order by ordinal_position
        `;
      });

      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (mode === "create-rule-ai-generation-table") {
      const result = await sql.begin(async (tx) => {
        await tx`
          create table if not exists public.rule_ai_generation
          (like public.rule including defaults including constraints including indexes)
        `;

        const rowCount = await tx`
          select count(*)::int as count
          from public.rule_ai_generation
        `;

        const columns = await tx`
          select
            column_name,
            data_type,
            is_nullable,
            column_default
          from information_schema.columns
          where table_schema = 'public'
            and table_name = 'rule_ai_generation'
          order by ordinal_position
        `;

        return {
          rowCount: rowCount[0],
          columns,
        };
      });

      console.log(JSON.stringify(result, null, 2));
      return;
    }

    throw new Error(`Unknown mode: ${mode}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

await main();
