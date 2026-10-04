import type { StyleProp, ViewStyle } from 'react-native';

/**
 * Where a shared building block sits in its parent: margins and `alignSelf` only, so a caller
 * can't restyle it or shrink its touch target.
 *
 * @example
 * <Button variant="text" label="Cancel" onPress={cancel} style={{ marginTop: 8 }} />
 */
export type Placement = StyleProp<
  Pick<
    ViewStyle,
    'margin' | 'marginTop' | 'marginBottom' | 'marginHorizontal' | 'marginVertical' | 'alignSelf'
  >
>;
