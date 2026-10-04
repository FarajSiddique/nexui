import type { ReactElement, ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { fonts, createThemedStyles } from '#theme';
import { AiText } from '#ui';

export interface ComparisonColumn {
  id: string;
  title: string;
  highlight: boolean;
  tentative: boolean;
}

export interface ComparisonRow {
  label: string;
  cells: string[];
}

/**
 * Objects side by side, one column each, scrolling sideways when they don't fit. Each row is
 * one accessible element read as "Detour: Shirakawa-go +1h 25m, Tsumago +2h 10m".
 */
export function ComparisonTable({
  columns,
  rows,
  footer,
}: {
  columns: ComparisonColumn[];
  rows: ComparisonRow[];
  footer?: (column: ComparisonColumn) => ReactNode;
}): ReactElement {
  const styles = useStyles();

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scroll}>
      <View>
        <View style={styles.row}>
          <View style={styles.labelCell} />
          {columns.map((column) => (
            <View key={column.id} style={[styles.cell, column.tentative && styles.tentative]}>
              <AiText
                text={column.title}
                highlight={column.highlight}
                tag={false}
                style={styles.head}
              />
            </View>
          ))}
        </View>
        {rows.map((row) => (
          <View
            key={row.label}
            accessible
            accessibilityLabel={`${row.label}: ${columns
              .map((column, index) => `${column.title} ${row.cells[index] ?? '—'}`)
              .join(', ')}`}
            style={[styles.row, styles.line]}
          >
            <Text style={[styles.labelCell, styles.label]}>{row.label}</Text>
            {row.cells.map((cell, index) => (
              <Text key={columns[index]?.id ?? index} style={[styles.cell, styles.value]}>
                {cell}
              </Text>
            ))}
          </View>
        ))}
        {footer ? (
          <View style={styles.row}>
            <View style={styles.labelCell} />
            {columns.map((column) => (
              <View key={column.id} style={styles.cell}>
                {footer(column)}
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

const useStyles = createThemedStyles((colors) => ({
  // Fills the parent's width whatever its alignItems. A centered parent would size the scroller
  // to its content and clip it on both sides instead of scrolling.
  scroll: { alignSelf: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  line: { borderTopWidth: 1, borderTopColor: colors.line },
  labelCell: { width: 84, paddingVertical: 8, paddingRight: 8 },
  cell: { width: 136, paddingVertical: 8, paddingHorizontal: 6 },
  tentative: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.line,
    borderRadius: 10,
  },
  head: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.ink },
  label: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.muted },
  value: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: colors.ink },
}));
