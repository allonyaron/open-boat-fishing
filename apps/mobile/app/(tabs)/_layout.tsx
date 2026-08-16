import { Tabs } from 'expo-router';
import { Colors } from '@/constants/Colors';

// Inline SVG-style tab icons using text for now — swap with react-native-vector-icons
// or @expo/vector-icons once dependencies are installed.
function CalendarIcon({ color }: { color: string }) {
  const { Text } = require('react-native');
  return <Text style={{ color, fontSize: 22 }}>🗓</Text>;
}

function TicketIcon({ color }: { color: string }) {
  const { Text } = require('react-native');
  return <Text style={{ color, fontSize: 22 }}>🎫</Text>;
}

function PersonIcon({ color }: { color: string }) {
  const { Text } = require('react-native');
  return <Text style={{ color, fontSize: 22 }}>👤</Text>;
}

function FishIcon({ color }: { color: string }) {
  const { Text } = require('react-native');
  return <Text style={{ color, fontSize: 22 }}>🐟</Text>;
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors.teal,
        tabBarInactiveTintColor: Colors.tabIconDefault,
        tabBarStyle: {
          backgroundColor: Colors.tabBackground,
          borderTopColor: Colors.border,
          borderTopWidth: 1,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
        headerStyle: {
          backgroundColor: Colors.teal,
        },
        headerTintColor: Colors.surface,
        headerTitleStyle: {
          fontWeight: '700',
        },
      }}
    >
      <Tabs.Screen
        name="trips"
        options={{
          title: 'Trips',
          headerTitle: process.env.EXPO_PUBLIC_OPERATOR_NAME ?? 'Fishing Charter',
          tabBarIcon: ({ color }) => <CalendarIcon color={color} />,
        }}
      />
      <Tabs.Screen
        name="tickets"
        options={{
          title: 'Tickets',
          tabBarIcon: ({ color }) => <TicketIcon color={color} />,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: 'Account',
          tabBarIcon: ({ color }) => <PersonIcon color={color} />,
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: 'Reports',
          tabBarIcon: ({ color }) => <FishIcon color={color} />,
        }}
      />
    </Tabs>
  );
}
