import React, { useState } from 'react';
import {
    View, Text, StyleSheet, TextInput, Pressable,
    ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useThemeColors } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { useEffectiveColorScheme } from '@/lib/settings-context';

export default function LoginScreen() {
    const colorScheme = useEffectiveColorScheme();
    const colors = useThemeColors(colorScheme);
    const insets = useSafeAreaInsets();
    const { signIn, signUp } = useAuth();

    const [mode, setMode] = useState<'login' | 'signup'>('login');
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async () => {
        if (!email.trim() || !password.trim()) {
            Alert.alert('Missing Fields', 'Please enter your email and password.');
            return;
        }
        if (mode === 'signup' && !name.trim()) {
            Alert.alert('Missing Name', 'Please enter your name.');
            return;
        }
        setIsLoading(true);
        try {
            if (mode === 'login') {
                await signIn(email.trim(), password);
            } else {
                await signUp(email.trim(), password, name.trim());
                Alert.alert('Account Created', 'Please check your email to verify your account, then sign in.', [
                    { text: 'OK', onPress: () => setMode('login') },
                ]);
            }
        } catch (err: any) {
            Alert.alert('Error', err.message || 'Authentication failed. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <KeyboardAvoidingView
            style={[styles.container, { backgroundColor: colors.background }]}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
            <ScrollView
                contentContainerStyle={[
                    styles.content,
                    { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 40 },
                ]}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
                <Animated.View entering={FadeInDown.duration(500).delay(100)} style={styles.header}>
                    <View style={[styles.logoCircle, { backgroundColor: colors.tint }]}>
                        <Ionicons name="medical" size={32} color="#fff" />
                    </View>
                    <Text style={[styles.appName, { color: colors.text }]}>DoMyNote Ambient</Text>
                    <Text style={[styles.tagline, { color: colors.textSecondary }]}>
                        AI-powered clinical documentation
                    </Text>
                </Animated.View>

                <Animated.View entering={FadeInDown.duration(500).delay(200)} style={styles.form}>
                    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                        <Text style={[styles.formTitle, { color: colors.text }]}>
                            {mode === 'login' ? 'Welcome back' : 'Create account'}
                        </Text>

                        {mode === 'signup' && (
                            <View style={styles.inputGroup}>
                                <Text style={[styles.label, { color: colors.textSecondary }]}>Full Name</Text>
                                <View style={[styles.inputWrapper, { borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}>
                                    <Ionicons name="person-outline" size={18} color={colors.textTertiary} />
                                    <TextInput
                                        style={[styles.input, { color: colors.text }]}
                                        placeholder="Dr. Jane Smith"
                                        placeholderTextColor={colors.textTertiary}
                                        value={name}
                                        onChangeText={setName}
                                        autoCapitalize="words"
                                        editable={!isLoading}
                                    />
                                </View>
                            </View>
                        )}

                        <View style={styles.inputGroup}>
                            <Text style={[styles.label, { color: colors.textSecondary }]}>Email</Text>
                            <View style={[styles.inputWrapper, { borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}>
                                <Ionicons name="mail-outline" size={18} color={colors.textTertiary} />
                                <TextInput
                                    style={[styles.input, { color: colors.text }]}
                                    placeholder="doctor@clinic.com"
                                    placeholderTextColor={colors.textTertiary}
                                    value={email}
                                    onChangeText={setEmail}
                                    keyboardType="email-address"
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    editable={!isLoading}
                                />
                            </View>
                        </View>

                        <View style={styles.inputGroup}>
                            <Text style={[styles.label, { color: colors.textSecondary }]}>Password</Text>
                            <View style={[styles.inputWrapper, { borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}>
                                <Ionicons name="lock-closed-outline" size={18} color={colors.textTertiary} />
                                <TextInput
                                    style={[styles.input, { color: colors.text }]}
                                    placeholder="••••••••"
                                    placeholderTextColor={colors.textTertiary}
                                    value={password}
                                    onChangeText={setPassword}
                                    secureTextEntry={!showPassword}
                                    editable={!isLoading}
                                />
                                <Pressable onPress={() => setShowPassword(!showPassword)} hitSlop={8}>
                                    <Ionicons
                                        name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                                        size={18}
                                        color={colors.textTertiary}
                                    />
                                </Pressable>
                            </View>
                        </View>

                        <Pressable
                            onPress={handleSubmit}
                            disabled={isLoading}
                            style={({ pressed }) => [
                                styles.submitBtn,
                                { backgroundColor: colors.tint, opacity: pressed || isLoading ? 0.8 : 1 },
                            ]}
                        >
                            {isLoading ? (
                                <ActivityIndicator color="#fff" />
                            ) : (
                                <>
                                    <Text style={styles.submitBtnText}>
                                        {mode === 'login' ? 'Sign In' : 'Create Account'}
                                    </Text>
                                    <Ionicons name="arrow-forward" size={18} color="#fff" />
                                </>
                            )}
                        </Pressable>
                    </View>

                    <Pressable
                        onPress={() => setMode(mode === 'login' ? 'signup' : 'login')}
                        style={styles.switchMode}
                    >
                        <Text style={[styles.switchModeText, { color: colors.textSecondary }]}>
                            {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
                            <Text style={{ color: colors.tint, fontFamily: 'Inter_600SemiBold' }}>
                                {mode === 'login' ? 'Sign Up' : 'Sign In'}
                            </Text>
                        </Text>
                    </Pressable>
                </Animated.View>

                <Animated.View entering={FadeInDown.duration(500).delay(350)} style={styles.compliance}>
                    <Ionicons name="shield-checkmark" size={14} color={colors.accent} />
                    <Text style={[styles.complianceText, { color: colors.textTertiary }]}>
                        HIPAA Compliant · End-to-end encrypted
                    </Text>
                </Animated.View>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    content: {
        paddingHorizontal: 24,
        gap: 32,
        flexGrow: 1,
        justifyContent: 'center',
    },
    header: { alignItems: 'center', gap: 12 },
    logoCircle: {
        width: 72,
        height: 72,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 4,
    },
    appName: {
        fontSize: 24,
        fontFamily: 'Inter_700Bold',
    },
    tagline: {
        fontSize: 14,
        fontFamily: 'Inter_400Regular',
        textAlign: 'center',
    },
    form: { gap: 16 },
    card: {
        borderRadius: 18,
        borderWidth: 1,
        padding: 20,
        gap: 16,
    },
    formTitle: {
        fontSize: 20,
        fontFamily: 'Inter_700Bold',
        marginBottom: 4,
    },
    inputGroup: { gap: 6 },
    label: {
        fontSize: 13,
        fontFamily: 'Inter_500Medium',
    },
    inputWrapper: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderRadius: 12,
        borderWidth: 1,
    },
    input: {
        flex: 1,
        fontSize: 15,
        fontFamily: 'Inter_400Regular',
    },
    submitBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 15,
        borderRadius: 14,
        marginTop: 4,
    },
    submitBtnText: {
        fontSize: 16,
        fontFamily: 'Inter_600SemiBold',
        color: '#fff',
    },
    switchMode: { alignItems: 'center', paddingVertical: 4 },
    switchModeText: { fontSize: 14, fontFamily: 'Inter_400Regular' },
    compliance: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
    },
    complianceText: { fontSize: 12, fontFamily: 'Inter_400Regular' },
});
