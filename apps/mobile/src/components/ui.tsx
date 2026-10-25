/** Small primitives on the design tokens: text, display numerals, buttons, chips, sections. */
import { Feather } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type StyleProp,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { colors, fonts, radius, tabular } from '@/theme';

export type IconName = ComponentProps<typeof Feather>['name'];

type TProps = TextProps & {
  size?: number;
  weight?: 'regular' | 'medium' | 'semibold' | 'bold';
  color?: string;
  muted?: boolean;
  num?: boolean;
  upper?: boolean;
  style?: StyleProp<TextStyle>;
};

/** Body text in Geist. */
export function T({
  size = 14,
  weight = 'regular',
  color,
  muted,
  num,
  upper,
  style,
  ...rest
}: TProps) {
  return (
    <Text
      {...rest}
      style={[
        {
          fontFamily: fonts[weight],
          fontSize: size,
          lineHeight: Math.round(size * 1.35),
          color: color ?? (muted ? colors.muted : colors.text),
        },
        num && tabular,
        upper && { textTransform: 'uppercase', letterSpacing: 0.8 },
        style,
      ]}
    />
  );
}

/** Scores, clocks, headlines: Barlow Condensed with tabular numerals. */
export function Display({ size = 28, color, style, ...rest }: TProps) {
  return (
    <Text
      {...rest}
      style={[
        {
          fontFamily: fonts.display,
          fontSize: size,
          lineHeight: Math.round(size * 1.05),
          color: color ?? colors.text,
        },
        tabular,
        style,
      ]}
    />
  );
}

/** Small uppercase section label. */
export function Label({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return (
    <T size={11} weight="semibold" muted upper style={style}>
      {children}
    </T>
  );
}

export function Section({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.section, style]}>{children}</View>;
}

type ButtonProps = Omit<PressableProps, 'style' | 'children'> & {
  icon?: IconName;
  label?: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  style?: StyleProp<ViewStyle>;
  /** Required when there's no label (icon-only). */
  accessibilityLabel?: string;
};

export function Button({
  icon,
  label,
  variant = 'secondary',
  size = 'md',
  style,
  ...rest
}: ButtonProps) {
  const h = size === 'sm' ? 32 : size === 'lg' ? 48 : 40;
  const fg = variant === 'primary' ? colors.background : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={6}
      {...rest}
      style={({ pressed }) => [
        styles.button,
        {
          height: h,
          minWidth: h,
          paddingHorizontal: label ? (size === 'sm' ? 10 : 14) : 0,
          backgroundColor:
            variant === 'primary'
              ? colors.text
              : variant === 'ghost'
                ? 'transparent'
                : colors.raised,
          opacity: rest.disabled ? 0.4 : pressed ? 0.7 : 1,
        },
        style,
      ]}
    >
      {icon && <Feather name={icon} size={size === 'sm' ? 15 : 18} color={fg} />}
      {label ? (
        <T size={size === 'sm' ? 12 : 14} weight="semibold" color={fg}>
          {label}
        </T>
      ) : null}
    </Pressable>
  );
}

/** Pill-style segmented choice (speeds, languages, tabs). */
export function Segmented<V extends string | number>({
  options,
  value,
  onChange,
  accessibilityLabel,
  style,
}: {
  options: { value: V; label: string }[];
  value: V;
  onChange: (v: V) => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[styles.segmented, style]}
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={[styles.segment, on && { backgroundColor: colors.text }]}
          >
            <T size={12} weight="semibold" num color={on ? colors.background : colors.muted}>
              {o.label}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Badge({
  label,
  tone = 'default',
  dot,
}: {
  label: string;
  tone?: 'default' | 'live' | 'stale' | 'muted';
  dot?: boolean;
}) {
  const c =
    tone === 'live'
      ? colors.live
      : tone === 'stale'
        ? colors.stale
        : tone === 'muted'
          ? colors.muted
          : colors.text;
  return (
    <View
      style={[styles.badge, { backgroundColor: tone === 'default' ? colors.raised : `${c}26` }]}
    >
      {dot && <View style={[styles.dot, { backgroundColor: c }]} />}
      <T size={11} weight="semibold" upper num color={c}>
        {label}
      </T>
    </View>
  );
}

export function TeamDot({ color, size = 8 }: { color: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
  );
}

export const styles = StyleSheet.create({
  section: { backgroundColor: colors.surface, borderRadius: radius.md, padding: 14, gap: 10 },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: radius.md,
  },
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.raised,
    borderRadius: radius.md,
    padding: 2,
  },
  segment: {
    height: 30,
    minWidth: 34,
    paddingHorizontal: 9,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 7,
    height: 20,
    borderRadius: radius.sm,
    alignSelf: 'flex-start',
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
