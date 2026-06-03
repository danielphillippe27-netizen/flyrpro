CREATE OR REPLACE FUNCTION public.generate_workspace_reports(
  p_workspace_id uuid,
  p_period text,
  p_period_start timestamp with time zone,
  p_period_end timestamp with time zone,
  p_prev_start timestamp with time zone,
  p_prev_end timestamp with time zone
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE
  v_member record;
  v_owner record;
  v_curr jsonb;
  v_prev jsonb;
  v_deltas jsonb;
  v_report_id uuid;
  v_member_reports_created int := 0;
  v_team_reports_created int := 0;
  v_notifications_created int := 0;
  v_title text := format('Your %s report is ready', p_period);
BEGIN
  -- Member reports + member notifications, only for members present during the reported period.
  FOR v_member IN
    SELECT wm.user_id
    FROM public.workspace_members wm
    WHERE wm.workspace_id = p_workspace_id
      AND wm.created_at <= p_period_end
  LOOP
    v_report_id := NULL;
    v_curr := public.compute_user_metrics(p_workspace_id, v_member.user_id, p_period_start, p_period_end);
    v_prev := public.compute_user_metrics(p_workspace_id, v_member.user_id, p_prev_start, p_prev_end);
    v_deltas := public.compute_deltas(v_curr, v_prev);

    INSERT INTO public.reports (
      workspace_id,
      scope,
      owner_user_id,
      subject_user_id,
      period,
      period_start,
      period_end,
      metrics,
      deltas
    )
    VALUES (
      p_workspace_id,
      'member',
      NULL,
      v_member.user_id,
      p_period,
      p_period_start,
      p_period_end,
      v_curr,
      v_deltas
    )
    ON CONFLICT (workspace_id, scope, owner_user_key, subject_user_key, period, period_start, period_end)
    DO NOTHING
    RETURNING id INTO v_report_id;

    IF v_report_id IS NOT NULL THEN
      v_member_reports_created := v_member_reports_created + 1;

      INSERT INTO public.notifications (
        workspace_id,
        user_id,
        type,
        title,
        body,
        data
      )
      VALUES (
        p_workspace_id,
        v_member.user_id,
        'report_ready',
        v_title,
        v_title,
        jsonb_build_object(
          'report_id', v_report_id,
          'period', p_period,
          'scope', 'member',
          'period_start', p_period_start,
          'period_end', p_period_end
        )
      );

      v_notifications_created := v_notifications_created + 1;
    END IF;
  END LOOP;

  -- Team report per owner + owner notifications, only for owners present during the reported period.
  FOR v_owner IN
    SELECT wm.user_id
    FROM public.workspace_members wm
    WHERE wm.workspace_id = p_workspace_id
      AND wm.role = 'owner'
      AND wm.created_at <= p_period_end
  LOOP
    v_report_id := NULL;
    v_curr := public.compute_team_metrics(p_workspace_id, p_period_start, p_period_end);
    v_prev := public.compute_team_metrics(p_workspace_id, p_prev_start, p_prev_end);
    v_deltas := public.compute_deltas(v_curr, v_prev);

    INSERT INTO public.reports (
      workspace_id,
      scope,
      owner_user_id,
      subject_user_id,
      period,
      period_start,
      period_end,
      metrics,
      deltas
    )
    VALUES (
      p_workspace_id,
      'team',
      v_owner.user_id,
      NULL,
      p_period,
      p_period_start,
      p_period_end,
      v_curr,
      v_deltas
    )
    ON CONFLICT (workspace_id, scope, owner_user_key, subject_user_key, period, period_start, period_end)
    DO NOTHING
    RETURNING id INTO v_report_id;

    IF v_report_id IS NOT NULL THEN
      v_team_reports_created := v_team_reports_created + 1;

      INSERT INTO public.notifications (
        workspace_id,
        user_id,
        type,
        title,
        body,
        data
      )
      VALUES (
        p_workspace_id,
        v_owner.user_id,
        'report_ready',
        v_title,
        format('Your team''s %s report is ready', p_period),
        jsonb_build_object(
          'report_id', v_report_id,
          'period', p_period,
          'scope', 'team',
          'period_start', p_period_start,
          'period_end', p_period_end
        )
      );

      v_notifications_created := v_notifications_created + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'workspace_id', p_workspace_id,
    'period', p_period,
    'period_start', p_period_start,
    'period_end', p_period_end,
    'member_reports_created', v_member_reports_created,
    'team_reports_created', v_team_reports_created,
    'notifications_created', v_notifications_created
  );
END;
$function$;
