import { Redirect } from 'expo-router';

export default function TabsIndex() {
  // expo-router needs a default screen for the "(tabs)" group.
  // We redirect "/" -> "/chats" (the Chats tab).
  return <Redirect href="/chats" />;
}

