import { Redirect } from 'expo-router';

const isMate = process.env.EXPO_PUBLIC_APP_VARIANT === 'mate';

export default function Index() {
  return <Redirect href={isMate ? '/(mate)' : '/(tabs)/trips'} />;
}
