import { Image } from 'expo-image';
import type { ReactElement } from 'react';
import { View } from 'react-native';

import { createThemedStyles } from '#theme';

/**
 * A place photo from our storage, `height` points tall and filling its width. It shows a soft
 * tile while the image loads, or when `uri` is null (still being looked up, or none beside
 * others that have one). The photo fades in and is cached on disk.
 *
 * It is decorative unless it has a `label`, such as "Photo of Berlin".
 *
 * @example
 * <PlacePhoto uri={photo.url} height={148} radius={16} />
 */
export function PlacePhoto({
  uri,
  height,
  radius = 0,
  label,
}: {
  uri: string | null;
  height: number;
  radius?: number;
  label?: string;
}): ReactElement {
  const styles = useStyles();

  return (
    <View
      accessible={label !== undefined}
      accessibilityRole={label === undefined ? undefined : 'image'}
      accessibilityLabel={label}
      importantForAccessibility={label === undefined ? 'no-hide-descendants' : 'yes'}
      style={[styles.frame, { height, borderRadius: radius }]}
    >
      {uri ? (
        <Image
          source={{ uri }}
          contentFit="cover"
          transition={200}
          cachePolicy="disk"
          accessible={false}
          alt=""
          style={styles.image}
        />
      ) : null}
    </View>
  );
}

const useStyles = createThemedStyles((colors) => ({
  frame: { overflow: 'hidden', backgroundColor: colors.soft },
  image: { width: '100%', height: '100%' },
}));
