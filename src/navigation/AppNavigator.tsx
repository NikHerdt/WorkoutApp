import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Text, View } from 'react-native';
import { colors } from '../theme/colors';
import HomeScreen from '../screens/HomeScreen';
import WorkoutScreen from '../screens/WorkoutScreen';
import HistoryScreen from '../screens/HistoryScreen';
import ExercisesScreen from '../screens/ExercisesScreen';
import ExerciseDetailScreen from '../screens/ExerciseDetailScreen';
import AddExerciseScreen from '../screens/AddExerciseScreen';

export type ExerciseDetailParams = {
  exerciseId: number;
  exerciseName: string;
  /** Program slot id for phase-wide substitutions (when viewing a substitute, this is still the template row). */
  programSlotTemplateExerciseId?: number;
};

export type HomeStackParamList = {
  Home: undefined;
  Workout: undefined;
  ExerciseDetail: ExerciseDetailParams;
};

export type ExercisesStackParamList = {
  ExercisesList: undefined;
  ExerciseDetail: ExerciseDetailParams;
  AddExercise: undefined;
};

export type HistoryStackParamList = {
  History: undefined;
  ExerciseDetail: ExerciseDetailParams;
};

const HomeStack = createNativeStackNavigator<HomeStackParamList>();
const ExercisesStack = createNativeStackNavigator<ExercisesStackParamList>();
const HistoryStack = createNativeStackNavigator<HistoryStackParamList>();
const Tab = createBottomTabNavigator();

const screenOptions = {
  headerStyle: { backgroundColor: colors.surface },
  headerTintColor: colors.text,
  headerTitleStyle: { fontWeight: '600' as const, fontSize: 17 },
  headerShadowVisible: false,
};

function HomeStackNavigator() {
  return (
    <HomeStack.Navigator screenOptions={screenOptions}>
      <HomeStack.Screen name="Home" component={HomeScreen} options={{ title: "Jeff Nippard PPL" }} />
      <HomeStack.Screen name="Workout" component={WorkoutScreen} options={{ title: "Workout", headerBackTitle: '' }} />
      <HomeStack.Screen name="ExerciseDetail" component={ExerciseDetailScreen} options={({ route }) => ({ title: route.params.exerciseName, headerBackTitle: '' })} />
    </HomeStack.Navigator>
  );
}

function ExercisesStackNavigator() {
  return (
    <ExercisesStack.Navigator screenOptions={screenOptions}>
      <ExercisesStack.Screen name="ExercisesList" component={ExercisesScreen} options={{ title: 'Exercises' }} />
      <ExercisesStack.Screen name="ExerciseDetail" component={ExerciseDetailScreen} options={({ route }) => ({ title: route.params.exerciseName, headerBackTitle: '' })} />
      <ExercisesStack.Screen name="AddExercise" component={AddExerciseScreen} options={{ title: 'Add Exercise', headerBackTitle: '' }} />
    </ExercisesStack.Navigator>
  );
}

function HistoryStackNavigator() {
  return (
    <HistoryStack.Navigator screenOptions={screenOptions}>
      <HistoryStack.Screen name="History" component={HistoryScreen} options={{ title: 'History' }} />
      <HistoryStack.Screen name="ExerciseDetail" component={ExerciseDetailScreen} options={({ route }) => ({ title: route.params.exerciseName, headerBackTitle: '' })} />
    </HistoryStack.Navigator>
  );
}

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const icons: Record<string, string> = {
    Today: '⚡',
    History: '📅',
    Exercises: '🏋️',
  };
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: 20 }}>{icons[name]}</Text>
      <Text style={{
        fontSize: 10,
        color: focused ? colors.accent : colors.textTertiary,
        marginTop: 2,
        fontWeight: focused ? '600' : '400',
      }}>
        {name}
      </Text>
    </View>
  );
}

export default function AppNavigator() {
  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            backgroundColor: colors.tabBar,
            borderTopColor: colors.tabBarBorder,
            borderTopWidth: 1,
            height: 75,
            paddingBottom: 16,
            paddingTop: 8,
          },
          tabBarShowLabel: false,
        }}
      >
        <Tab.Screen
          name="TodayTab"
          component={HomeStackNavigator}
          options={{ tabBarIcon: ({ focused }) => <TabIcon name="Today" focused={focused} /> }}
        />
        <Tab.Screen
          name="HistoryTab"
          component={HistoryStackNavigator}
          options={{ tabBarIcon: ({ focused }) => <TabIcon name="History" focused={focused} /> }}
        />
        <Tab.Screen
          name="ExercisesTab"
          component={ExercisesStackNavigator}
          options={{ tabBarIcon: ({ focused }) => <TabIcon name="Exercises" focused={focused} /> }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}
