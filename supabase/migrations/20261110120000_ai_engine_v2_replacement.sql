BEGIN;

CREATE OR REPLACE FUNCTION public."AI_Crypto_Bot_Run_Database_AI_Analysis"(p_analysis_time timestamptz)
RETURNS TABLE(
  analyzed_markets integer,
  decisions_stored integer,
  buy_count integer,
  sell_count integer,
  hold_count integer,
  wait_count integer
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_market record;
  v_interval_row record;
  v_symbol text;
  v_interval text;
  v_max_age_ms bigint;
  v_snapshot public."AI_Crypto_Bot_Market_Data"%ROWTYPE;
  v_snapshot_found boolean;
  v_snapshot_stale boolean;
  v_snapshot_available boolean;
  v_snapshot_time_ms bigint;
  v_now_ms bigint;
  v_price double precision;
  v_daily_change double precision;
  v_volume double precision;
  v_high24h double precision;
  v_low24h double precision;
  v_range_position numeric;
  v_market_change_score double precision;
  v_range_position_score double precision;
  v_market_context_score double precision;
  v_timeframe_score numeric;
  v_score numeric;
  v_confidence double precision;
  v_confidence_numeric numeric;
  v_candle_coverage double precision;
  v_average_depth double precision;
  v_depth_total double precision;
  v_volatility_penalty double precision;
  v_sufficient boolean;
  v_v2_inputs_available boolean;
  v_daily_spread double precision;
  v_daily_rsi double precision;
  v_hourly_volume_ratio double precision;
  v_daily_ema_score double precision;
  v_daily_rsi_score double precision;
  v_hourly_direction text;
  v_daily_direction text;
  v_alignment_confirmation double precision;
  v_volume_confirmation double precision;
  v_rsi_confirmation double precision;
  v_trend_strength double precision;
  v_decision text;
  v_reason text;
  v_timeframe_text text;
  v_timeframes jsonb;
  v_indicators jsonb;
  v_market_data_indicator jsonb;
  v_tf_indicators jsonb;
  v_closes double precision[];
  v_highs double precision[];
  v_lows double precision[];
  v_volumes double precision[];
  v_timestamps timestamptz[];
  v_valid_count integer;
  v_invalid_count integer;
  v_total_invalid integer;
  v_stale_count integer;
  v_stale_ignored integer;
  v_stale_intervals text[];
  v_valid_intervals text[];
  v_valid_scores numeric[];
  v_valid_counts integer[];
  v_valid_volatility_levels text[];
  v_valid_weights double precision[];
  v_latest_candle_ms bigint;
  v_fresh boolean;
  v_index integer;
  v_valid_total integer;
  v_weight_total double precision;
  v_weighted_total double precision;
BEGIN
  IF p_analysis_time IS NULL OR NOT pg_catalog.isfinite(p_analysis_time) THEN
    RAISE EXCEPTION 'Analysis time must be a finite timestamp.'
      USING ERRCODE = '22023';
  END IF;

  v_now_ms := FLOOR(EXTRACT(epoch FROM p_analysis_time) * 1000)::bigint;
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT symbol
      FROM public."AI_Crypto_Bot_Watched_Markets"
      WHERE enabled = true
      ORDER BY priority ASC, symbol ASC
      LIMIT 2000
    ) AS bounded_markets
    WHERE bounded_markets.symbol !~ '^[A-Z0-9]+-EUR$'
  ) THEN
    RAISE EXCEPTION 'Enabled watched markets contain an invalid EUR symbol.'
      USING ERRCODE = '22023';
  END IF;

  analyzed_markets := 0;
  decisions_stored := 0;
  buy_count := 0;
  sell_count := 0;
  hold_count := 0;
  wait_count := 0;

  FOR v_market IN
    SELECT symbol
    FROM public."AI_Crypto_Bot_Watched_Markets"
    WHERE enabled = true
    ORDER BY priority ASC, symbol ASC
    LIMIT 2000
  LOOP
    v_symbol := v_market.symbol;
    v_timeframes := '{}'::jsonb;
    v_valid_intervals := '{}'::text[];
    v_valid_scores := '{}'::numeric[];
    v_valid_counts := '{}'::integer[];
    v_valid_volatility_levels := '{}'::text[];
    v_valid_weights := '{}'::double precision[];
    v_stale_intervals := '{}'::text[];
    v_total_invalid := 0;
    v_stale_ignored := 0;
    v_depth_total := 0;
    v_volatility_penalty := 0;

    SELECT
      market_data.id,
      market_data.symbol,
      market_data.price,
      market_data.volume,
      market_data.daily_change,
      market_data.high_24h,
      market_data.low_24h,
      market_data.captured_at
    INTO v_snapshot
    FROM public."AI_Crypto_Bot_Market_Data" AS market_data
    WHERE market_data.symbol = v_symbol;
    v_snapshot_found := FOUND;
    v_snapshot_stale := false;
    v_snapshot_available := false;
    v_price := NULL;
    v_daily_change := NULL;
    v_volume := NULL;
    v_high24h := NULL;
    v_low24h := NULL;
    v_range_position := NULL;
    v_market_change_score := NULL;
    v_range_position_score := NULL;
    v_market_context_score := NULL;

    IF v_snapshot_found THEN
      v_price := v_snapshot.price::double precision;
      v_daily_change := v_snapshot.daily_change::double precision;
      v_volume := v_snapshot.volume::double precision;
      v_high24h := v_snapshot.high_24h::double precision;
      v_low24h := v_snapshot.low_24h::double precision;
      v_snapshot_stale := CASE
        WHEN NOT pg_catalog.isfinite(v_snapshot.captured_at) THEN true
        ELSE v_now_ms - FLOOR(EXTRACT(epoch FROM v_snapshot.captured_at) * 1000)::bigint
            > 900000
          OR v_now_ms < FLOOR(EXTRACT(epoch FROM v_snapshot.captured_at) * 1000)::bigint
      END;
      v_snapshot_available := NOT v_snapshot_stale
        AND v_price > 0
        AND v_price NOT IN (
          'NaN'::double precision,
          'Infinity'::double precision,
          '-Infinity'::double precision
        )
        AND v_daily_change NOT IN (
          'NaN'::double precision,
          'Infinity'::double precision,
          '-Infinity'::double precision
        )
        AND v_volume >= 0
        AND v_volume NOT IN (
          'NaN'::double precision,
          'Infinity'::double precision,
          '-Infinity'::double precision
        );

      IF v_snapshot_available THEN
        v_market_change_score := "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Clamp"(
          v_daily_change * 8, -100, 100
        );
      END IF;

      IF v_price > 0
        AND v_price NOT IN (
          'NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision
        )
        AND v_high24h > v_low24h
        AND v_high24h NOT IN (
          'NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision
        )
        AND v_low24h NOT IN (
          'NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision
        )
        AND v_low24h >= 0
        AND v_price >= v_low24h AND v_price <= v_high24h THEN
        v_range_position := "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Round"(
          (v_price - v_low24h) / (v_high24h - v_low24h) * 100
        );
        v_range_position_score := "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Clamp"(
          (v_range_position::double precision - 50) * 2, -100, 100
        );
      END IF;

      IF v_market_change_score IS NOT NULL THEN
        v_market_context_score := CASE
          WHEN v_range_position_score IS NULL THEN v_market_change_score
          ELSE v_market_change_score * 0.7 + v_range_position_score * 0.3
        END;
      END IF;
    END IF;

    FOR v_interval_row IN
      WITH intervals (ordinal, interval_name, max_age_ms, weight) AS (
        VALUES
          (1, '1m'::text, 1800000::bigint, 0.05::double precision),
          (2, '5m'::text, 7200000::bigint, 0.1::double precision),
          (3, '15m'::text, 21600000::bigint, 0.15::double precision),
          (4, '1h'::text, 43200000::bigint, 0.25::double precision),
          (5, '4h'::text, 86400000::bigint, 0.3::double precision),
          (6, '1d'::text, 259200000::bigint, 0.15::double precision)
      )
      SELECT
        intervals.interval_name,
        intervals.max_age_ms,
        intervals.weight,
        candle_data.invalid_count,
        candle_data.closes,
        candle_data.highs,
        candle_data.lows,
        candle_data.volumes,
        candle_data.timestamps
      FROM intervals
      CROSS JOIN LATERAL (
        WITH bounded AS (
          SELECT
            candle.timestamp,
            candle.open::double precision AS open_value,
            candle.high::double precision AS high_value,
            candle.low::double precision AS low_value,
            candle.close::double precision AS close_value,
            candle.volume::double precision AS volume_value
          FROM public."AI_Crypto_Bot_Candles" AS candle
          WHERE candle.symbol = v_symbol
            AND candle.interval = intervals.interval_name
          ORDER BY candle.timestamp DESC
          LIMIT 150
        ),
        classified AS (
          SELECT
            bounded.timestamp,
            bounded.open_value,
            bounded.high_value,
            bounded.low_value,
            bounded.close_value,
            bounded.volume_value,
            (
              pg_catalog.isfinite(bounded.timestamp)
              AND bounded.open_value > 0
              AND bounded.close_value > 0
              AND bounded.volume_value >= 0
              AND bounded.open_value NOT IN (
                'NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision
              )
              AND bounded.high_value NOT IN (
                'NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision
              )
              AND bounded.low_value NOT IN (
                'NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision
              )
              AND bounded.close_value NOT IN (
                'NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision
              )
              AND bounded.volume_value NOT IN (
                'NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision
              )
              AND bounded.high_value >= GREATEST(
                bounded.open_value, bounded.close_value, bounded.low_value
              )
              AND bounded.low_value <= LEAST(
                bounded.open_value, bounded.close_value
              )
            ) AS valid
          FROM bounded
        )
        SELECT
          COUNT(*) FILTER (WHERE NOT classified.valid)::integer AS invalid_count,
          COALESCE(
            pg_catalog.array_agg(classified.close_value ORDER BY
              FLOOR(EXTRACT(epoch FROM classified.timestamp) * 1000),
              classified.timestamp DESC
            ) FILTER (WHERE classified.valid),
            '{}'::double precision[]
          ) AS closes,
          COALESCE(
            pg_catalog.array_agg(classified.high_value ORDER BY
              FLOOR(EXTRACT(epoch FROM classified.timestamp) * 1000),
              classified.timestamp DESC
            ) FILTER (WHERE classified.valid),
            '{}'::double precision[]
          ) AS highs,
          COALESCE(
            pg_catalog.array_agg(classified.low_value ORDER BY
              FLOOR(EXTRACT(epoch FROM classified.timestamp) * 1000),
              classified.timestamp DESC
            ) FILTER (WHERE classified.valid),
            '{}'::double precision[]
          ) AS lows,
          COALESCE(
            pg_catalog.array_agg(classified.volume_value ORDER BY
              FLOOR(EXTRACT(epoch FROM classified.timestamp) * 1000),
              classified.timestamp DESC
            ) FILTER (WHERE classified.valid),
            '{}'::double precision[]
          ) AS volumes,
          COALESCE(
            pg_catalog.array_agg(classified.timestamp ORDER BY
              FLOOR(EXTRACT(epoch FROM classified.timestamp) * 1000),
              classified.timestamp DESC
            ) FILTER (WHERE classified.valid),
            '{}'::timestamptz[]
          ) AS timestamps
        FROM classified
      ) AS candle_data
      ORDER BY intervals.ordinal
    LOOP
      v_interval := v_interval_row.interval_name;
      v_max_age_ms := v_interval_row.max_age_ms;
      v_invalid_count := v_interval_row.invalid_count;
      v_closes := v_interval_row.closes;
      v_highs := v_interval_row.highs;
      v_lows := v_interval_row.lows;
      v_volumes := v_interval_row.volumes;
      v_timestamps := v_interval_row.timestamps;

      v_valid_count := COALESCE(pg_catalog.array_length(v_closes, 1), 0);
      v_total_invalid := v_total_invalid + v_invalid_count;
      v_stale_count := 0;
      v_fresh := false;
      IF v_valid_count > 0 THEN
        v_latest_candle_ms := FLOOR(
          EXTRACT(epoch FROM v_timestamps[v_valid_count]) * 1000
        )::bigint;
        v_fresh := v_now_ms - v_latest_candle_ms >= 0
          AND v_now_ms - v_latest_candle_ms <= v_max_age_ms;
        IF NOT v_fresh THEN
          v_stale_count := v_valid_count;
          v_stale_ignored := v_stale_ignored + v_valid_count;
          v_stale_intervals := pg_catalog.array_append(v_stale_intervals, v_interval);
        END IF;
      END IF;

      IF v_fresh THEN
        SELECT timeframe.score, timeframe.indicators
        INTO v_timeframe_score, v_tf_indicators
        FROM "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Timeframe"(
          v_highs,
          v_lows,
          v_closes,
          v_volumes
        ) AS timeframe;
      ELSE
        v_timeframe_score := NULL;
        SELECT timeframe.score, timeframe.indicators
        INTO v_timeframe_score, v_tf_indicators
        FROM "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Timeframe"(
          '{}'::double precision[],
          '{}'::double precision[],
          '{}'::double precision[],
          '{}'::double precision[]
        ) AS timeframe;
      END IF;

      v_timeframes := v_timeframes || pg_catalog.jsonb_build_object(
        v_interval,
        pg_catalog.jsonb_build_object(
          'candleCount', v_valid_count,
          'analyzedCandleCount', CASE WHEN v_fresh THEN v_valid_count ELSE 0 END,
          'staleCandleCount', v_stale_count,
          'stale', v_stale_count > 0,
          'invalidCandleCount', v_invalid_count,
          'trend', v_tf_indicators -> 'trend',
          'momentum', v_tf_indicators -> 'momentum',
          'rsi14', v_tf_indicators -> 'rsi14',
          'macd', v_tf_indicators -> 'macd',
          'volume', v_tf_indicators -> 'volume',
          'volatility', v_tf_indicators -> 'volatility'
        )
      );

      IF v_fresh AND v_valid_count >= 26 THEN
        v_valid_intervals := pg_catalog.array_append(v_valid_intervals, v_interval);
        v_valid_scores := pg_catalog.array_append(v_valid_scores, v_timeframe_score);
        v_valid_counts := pg_catalog.array_append(v_valid_counts, v_valid_count);
        v_valid_volatility_levels := pg_catalog.array_append(
          v_valid_volatility_levels,
          v_tf_indicators #>> '{volatility,level}'
        );
        v_valid_weights := pg_catalog.array_append(v_valid_weights, v_interval_row.weight);
        v_depth_total := v_depth_total + LEAST(v_valid_count::double precision / 100, 1);
        v_volatility_penalty := v_volatility_penalty
          + CASE v_tf_indicators #>> '{volatility,level}'
              WHEN 'high' THEN 12
              WHEN 'medium' THEN 4
              ELSE 0
            END;
      END IF;
    END LOOP;

    v_valid_total := COALESCE(pg_catalog.array_length(v_valid_intervals, 1), 0);
    v_candle_coverage := v_valid_total::double precision / 6;
    v_average_depth := CASE WHEN v_valid_total = 0 THEN 0
      ELSE v_depth_total / v_valid_total END;
    v_volatility_penalty := CASE WHEN v_valid_total = 0 THEN 0
      ELSE v_volatility_penalty / v_valid_total END;

    v_weight_total := 0;
    v_weighted_total := 0;
    FOR v_index IN 1..v_valid_total LOOP
      v_weight_total := v_weight_total + v_valid_weights[v_index];
      v_weighted_total := v_weighted_total
        + v_valid_scores[v_index]::double precision * v_valid_weights[v_index];
    END LOOP;
    IF v_weight_total > 0 THEN
      v_timeframe_score := "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Round"(
        v_weighted_total / v_weight_total
      );
    ELSE
      v_timeframe_score := NULL;
    END IF;

    v_daily_spread := NULLIF(v_timeframes #>> '{1d,trend,percentSpread}', '')::double precision;
    v_daily_rsi := NULLIF(v_timeframes #>> '{1d,rsi14}', '')::double precision;
    v_hourly_volume_ratio := NULLIF(v_timeframes #>> '{1h,volume,ratio}', '')::double precision;
    v_hourly_direction := v_timeframes #>> '{1h,trend,direction}';
    v_daily_direction := v_timeframes #>> '{1d,trend,direction}';
    v_v2_inputs_available := COALESCE(
      '1h' = ANY(v_valid_intervals)
      AND '1d' = ANY(v_valid_intervals)
      AND v_daily_spread IS NOT NULL
      AND v_daily_spread NOT IN ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)
      AND v_daily_rsi IS NOT NULL
      AND v_daily_rsi NOT IN ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)
      AND v_hourly_volume_ratio IS NOT NULL
      AND v_hourly_volume_ratio >= 0
      AND v_hourly_volume_ratio NOT IN ('NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision)
      AND v_hourly_direction IN ('bullish', 'bearish', 'sideways')
      AND v_daily_direction IN ('bullish', 'bearish', 'sideways'),
      false
    );
    IF v_v2_inputs_available THEN
      v_daily_ema_score := "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Clamp"(
        v_daily_spread * 50, -100, 100
      );
      v_daily_rsi_score := "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Clamp"(
        (v_daily_rsi - 50) * 2, -100, 100
      );
      v_alignment_confirmation := CASE
        WHEN v_hourly_direction = v_daily_direction AND v_daily_direction <> 'sideways' THEN 1
        ELSE 0
      END;
      v_volume_confirmation := "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Clamp"(
        v_hourly_volume_ratio - 0.5, 0, 1
      );
      v_rsi_confirmation := "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Clamp"(
        GREATEST(0, SIGN(v_daily_ema_score) * v_daily_rsi_score / 100), 0, 1
      );
      v_trend_strength := ABS(v_daily_ema_score) / 100;
      v_score := "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Round"(
        "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Clamp"(
          0.75 * v_daily_ema_score
            + 0.10 * v_daily_ema_score * v_alignment_confirmation
            + 0.10 * v_daily_ema_score * v_volume_confirmation
            + 0.05 * v_daily_rsi_score,
          -100,
          100
        )
      );
    ELSE
      v_score := NULL;
    END IF;
    v_sufficient := v_snapshot_available AND v_valid_total >= 2;
    IF v_sufficient AND v_v2_inputs_available THEN
      v_confidence := "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Clamp"(
        40 + 30 * v_trend_strength + 10 * v_alignment_confirmation
          + 10 * v_volume_confirmation + 5 * v_rsi_confirmation - v_volatility_penalty,
        0,
        95
      );
    ELSE
      v_confidence := "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Clamp"(
        12 + v_candle_coverage * 20 + v_average_depth * 12
          + CASE WHEN v_snapshot_available THEN 6 ELSE 0 END,
        0,
        49
      );
    END IF;
    IF v_valid_total < 4 THEN
      v_confidence := LEAST(v_confidence, 64);
    END IF;
    v_confidence_numeric := "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Round"(v_confidence);

    v_decision := 'WAIT';
    IF v_sufficient AND v_v2_inputs_available THEN
      IF ABS(v_score) < 20 OR v_confidence_numeric < 65 THEN
        v_decision := 'HOLD';
      ELSE
        v_decision := CASE WHEN v_score > 0 THEN 'BUY' ELSE 'SELL' END;
      END IF;
    END IF;

    v_timeframe_text := v_valid_total::text
      || '/6 candle intervals have at least 26 valid candles';
    IF v_valid_total < 2 AND pg_catalog.array_length(v_stale_intervals, 1) > 0 THEN
      v_reason := 'STALE_CANDLE_DATA';
    ELSIF NOT v_snapshot_available THEN
      v_reason := 'WAIT: current market snapshot is missing, invalid, or stale; '
        || v_timeframe_text || '.';
    ELSIF v_valid_total < 2 THEN
      v_reason := 'WAIT: insufficient real candle history; '
        || v_timeframe_text || '.';
    ELSIF NOT v_v2_inputs_available THEN
      v_reason := 'WAIT: fresh 1h volume ratio and 1d EMA/RSI inputs are required for V2 analysis; '
        || v_timeframe_text || '.';
    ELSIF v_decision = 'HOLD' THEN
      v_reason := 'HOLD: market strength '
        || CASE WHEN v_score = 0 THEN '0'
                ELSE pg_catalog.trim_scale(v_score)::text END
        || ' is neutral or confidence is reduced by incomplete data; '
        || v_timeframe_text || '.';
    ELSE
      v_reason := v_decision
        || ': daily EMA trend, hourly volume confirmation, daily RSI, and volatility produced a '
        || CASE WHEN v_score = 0 THEN '0'
                ELSE pg_catalog.trim_scale(v_score)::text END
        || ' V2 market-strength score.'
        || CASE WHEN v_total_invalid > 0
          THEN ' ' || v_total_invalid::text || ' invalid candle records were ignored.'
          ELSE '' END;
    END IF;

    v_market_data_indicator := pg_catalog.jsonb_build_object(
      'available', v_snapshot_available,
      'price', CASE WHEN v_price > 0
        AND v_price NOT IN (
          'NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision
        ) THEN v_snapshot.price ELSE NULL END,
      'dailyChangePct', CASE
        WHEN v_daily_change NOT IN (
          'NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision
        ) THEN v_snapshot.daily_change ELSE NULL END,
      'volume', CASE WHEN v_volume >= 0
        AND v_volume NOT IN (
          'NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision
        ) THEN v_snapshot.volume ELSE NULL END,
      'high24h', CASE WHEN v_high24h > 0
        AND v_high24h NOT IN (
          'NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision
        ) THEN v_snapshot.high_24h ELSE NULL END,
      'low24h', CASE WHEN v_low24h >= 0
        AND v_low24h NOT IN (
          'NaN'::double precision, 'Infinity'::double precision, '-Infinity'::double precision
        ) THEN v_snapshot.low_24h ELSE NULL END,
      'rangePositionPct', v_range_position,
      'capturedAt', CASE WHEN v_snapshot_found
        THEN pg_catalog.to_jsonb(v_snapshot.captured_at) #>> '{}' ELSE NULL END,
      'stale', v_snapshot_stale
    );

    v_indicators := pg_catalog.jsonb_build_object(
      'marketData', v_market_data_indicator,
      'timeframes', v_timeframes,
      'marketStrength', v_score,
      'dataQuality', pg_catalog.jsonb_build_object(
        'candleIntervalsAvailable', pg_catalog.to_jsonb(v_valid_intervals),
        'candleIntervalsRequiredForAnalysis', 2,
        'candleCoverage', "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Round"(v_candle_coverage * 100),
        'invalidCandlesIgnored', v_total_invalid,
        'staleCandleIntervals', pg_catalog.to_jsonb(v_stale_intervals),
        'staleCandlesIgnored', v_stale_ignored,
        'marketSnapshotAvailable', v_snapshot_available,
        'sufficientForDirectionalSignal', v_sufficient
          AND v_v2_inputs_available
          AND v_valid_total >= 4
          AND v_confidence_numeric >= 65
      )
    );

    INSERT INTO public."AI_Crypto_Bot_AI_Decisions" (
      symbol,
      decision,
      confidence,
      reason,
      indicators,
      strategy_name,
      strategy_version
    )
    VALUES (
      v_symbol,
      v_decision,
      v_confidence_numeric,
      v_reason,
      v_indicators,
      'Deterministic Technical Analysis V2',
      '2.0.0'
    );

    analyzed_markets := analyzed_markets + 1;
    decisions_stored := decisions_stored + 1;
    CASE v_decision
      WHEN 'BUY' THEN buy_count := buy_count + 1;
      WHEN 'SELL' THEN sell_count := sell_count + 1;
      WHEN 'HOLD' THEN hold_count := hold_count + 1;
      WHEN 'WAIT' THEN wait_count := wait_count + 1;
    END CASE;
  END LOOP;

  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public."AI_Crypto_Bot_Run_Database_AI_Analysis"(timestamptz)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Round"(double precision)
  TO service_role;
GRANT EXECUTE ON FUNCTION "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Clamp"(
  double precision, double precision, double precision
) TO service_role;
GRANT EXECUTE ON FUNCTION "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Ema_Series"(
  double precision[], integer
) TO service_role;
GRANT EXECUTE ON FUNCTION "AI_Crypto_Bot_Internal"."AI_Crypto_Bot_AI_Analysis_Timeframe"(
  double precision[], double precision[], double precision[], double precision[]
) TO service_role;
GRANT EXECUTE ON FUNCTION public."AI_Crypto_Bot_Run_Database_AI_Analysis"(timestamptz)
  TO service_role;


COMMIT;
