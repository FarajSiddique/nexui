import { Redirect } from 'expo-router';
import type { ReactElement } from 'react';

// The + tab's route is never shown: its tab bar button opens `/compose` instead. A deep
// link that lands here goes Home.
export default function PlusPlaceholder(): ReactElement {
  return <Redirect href="/" />;
}
