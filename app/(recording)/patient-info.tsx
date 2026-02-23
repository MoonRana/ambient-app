import React, { useState } from 'react';
import {
    View, Text, StyleSheet, TextInput, Pressable, Platform,
    ScrollView, KeyboardAvoidingView, Alert, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useThemeColors } from '@/constants/colors';
import { useSessions } from '@/lib/session-context';
import * as Haptics from 'expo-haptics';
import { useEffectiveColorScheme } from '@/lib/settings-context';

interface Medication {
    id: string;
    name: string;
    dosage: string;
    frequency: string;
}

function genId() {
    return Date.now().toString() + Math.random().toString(36).slice(2, 7);
}

export default function PatientInfoScreen() {
    const colorScheme = useEffectiveColorScheme();
    const colors = useThemeColors(colorScheme);
    const insets = useSafeAreaInsets();
    const { currentSession, updateSession } = useSessions();

    const existing = currentSession?.patientInfo;
    const [patientName, setPatientName] = useState(existing?.name || '');
    const [dob, setDob] = useState(existing?.dateOfBirth || '');
    const [memberId, setMemberId] = useState(existing?.memberId || '');
    const [groupNumber, setGroupNumber] = useState(existing?.groupNumber || '');
    const [payerName, setPayerName] = useState(existing?.payerName || '');
    const [address, setAddress] = useState(existing?.address || '');
    const [medications, setMedications] = useState<Medication[]>([]);
    const [isSaving, setIsSaving] = useState(false);

    const addMedication = () => {
        setMedications(prev => [...prev, { id: genId(), name: '', dosage: '', frequency: '' }]);
        if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    };

    const updateMedication = (id: string, field: keyof Medication, value: string) => {
        setMedications(prev => prev.map(m => m.id === id ? { ...m, [field]: value } : m));
    };

    const removeMedication = (id: string) => {
        setMedications(prev => prev.filter(m => m.id !== id));
        if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    };

    const handleSave = async () => {
        if (!currentSession) return;
        setIsSaving(true);

        updateSession(currentSession.id, {
            patientInfo: {
                name: patientName || undefined,
                dateOfBirth: dob || undefined,
                memberId: memberId || undefined,
                groupNumber: groupNumber || undefined,
                payerName: payerName || undefined,
                address: address || undefined,
            },
        });

        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setIsSaving(false);
        router.back();
    };

    const InputField = ({
        label, value, onChange, icon, placeholder, keyboard = 'default',
    }: {
        label: string; value: string; onChange: (v: string) => void;
        icon: keyof typeof Ionicons.glyphMap; placeholder: string;
        keyboard?: any;
    }) => (
        <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
            <View style={[styles.inputWrapper, { borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}>
                <Ionicons name={icon} size={16} color={colors.textTertiary} />
                <TextInput
                    style={[styles.input, { color: colors.text }]}
                    placeholder={placeholder}
                    placeholderTextColor={colors.textTertiary}
                    value={value}
                    onChangeText={onChange}
                    keyboardType={keyboard}
                />
            </View>
        </View>
    );

    return (
        <KeyboardAvoidingView
            style={[styles.container, { backgroundColor: colors.background }]}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
            <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
                <Pressable
                    onPress={() => router.back()}
                    hitSlop={12}
                    style={[styles.headerBtn, { backgroundColor: colors.surfaceSecondary }]}
                >
                    <Ionicons name="close" size={22} color={colors.text} />
                </Pressable>
                <Text style={[styles.headerTitle, { color: colors.text }]}>Patient Information</Text>
                <Pressable
                    onPress={handleSave}
                    disabled={isSaving}
                    style={[styles.saveBtn, { backgroundColor: colors.tint }]}
                >
                    {isSaving ? (
                        <ActivityIndicator color="#fff" size="small" />
                    ) : (
                        <Text style={styles.saveBtnText}>Save</Text>
                    )}
                </Pressable>
            </View>

            <ScrollView
                contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 32 }]}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
            >
                {/* Patient Details */}
                <Animated.View entering={FadeInDown.duration(400).delay(50)}>
                    <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>Patient Details</Text>
                    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                        <InputField label="Full Name" value={patientName} onChange={setPatientName} icon="person-outline" placeholder="John Doe" />
                        <InputField label="Date of Birth" value={dob} onChange={setDob} icon="calendar-outline" placeholder="MM/DD/YYYY" />
                    </View>
                </Animated.View>

                {/* Insurance */}
                <Animated.View entering={FadeInDown.duration(400).delay(100)}>
                    <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>Insurance</Text>
                    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                        <InputField label="Payer / Insurance Company" value={payerName} onChange={setPayerName} icon="business-outline" placeholder="Aetna, BCBS, etc." />
                        <InputField label="Member ID" value={memberId} onChange={setMemberId} icon="card-outline" placeholder="XYZ123456789" />
                        <InputField label="Group Number" value={groupNumber} onChange={setGroupNumber} icon="grid-outline" placeholder="GRP-001" />
                        <InputField label="Address" value={address} onChange={setAddress} icon="location-outline" placeholder="123 Main St, City, ST 12345" />
                    </View>
                </Animated.View>

                {/* Medications */}
                <Animated.View entering={FadeInDown.duration(400).delay(150)}>
                    <View style={styles.sectionRow}>
                        <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>Medications</Text>
                        <Pressable
                            onPress={addMedication}
                            style={[styles.addBtn, { backgroundColor: colors.tintLight }]}
                        >
                            <Ionicons name="add" size={16} color={colors.tint} />
                            <Text style={[styles.addBtnText, { color: colors.tint }]}>Add</Text>
                        </Pressable>
                    </View>

                    {medications.length === 0 ? (
                        <View style={[styles.emptyMed, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                            <Ionicons name="medical-outline" size={28} color={colors.textTertiary} />
                            <Text style={[styles.emptyMedText, { color: colors.textTertiary }]}>No medications added</Text>
                            <Text style={[styles.emptyMedSub, { color: colors.textTertiary }]}>Tap Add to include current medications</Text>
                        </View>
                    ) : (
                        medications.map((med, idx) => (
                            <Animated.View
                                key={med.id}
                                entering={FadeInDown.duration(300)}
                                style={[styles.medCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
                            >
                                <View style={styles.medCardHeader}>
                                    <Text style={[styles.medNum, { color: colors.textSecondary }]}>Medication {idx + 1}</Text>
                                    <Pressable onPress={() => removeMedication(med.id)} hitSlop={8}>
                                        <Ionicons name="trash-outline" size={16} color={colors.recording} />
                                    </Pressable>
                                </View>
                                <TextInput
                                    style={[styles.medInput, { borderColor: colors.border, backgroundColor: colors.surfaceSecondary, color: colors.text }]}
                                    placeholder="Medication name"
                                    placeholderTextColor={colors.textTertiary}
                                    value={med.name}
                                    onChangeText={v => updateMedication(med.id, 'name', v)}
                                />
                                <View style={styles.medRow}>
                                    <TextInput
                                        style={[styles.medInputHalf, { borderColor: colors.border, backgroundColor: colors.surfaceSecondary, color: colors.text }]}
                                        placeholder="Dosage (e.g. 10mg)"
                                        placeholderTextColor={colors.textTertiary}
                                        value={med.dosage}
                                        onChangeText={v => updateMedication(med.id, 'dosage', v)}
                                    />
                                    <TextInput
                                        style={[styles.medInputHalf, { borderColor: colors.border, backgroundColor: colors.surfaceSecondary, color: colors.text }]}
                                        placeholder="Frequency (e.g. Daily)"
                                        placeholderTextColor={colors.textTertiary}
                                        value={med.frequency}
                                        onChangeText={v => updateMedication(med.id, 'frequency', v)}
                                    />
                                </View>
                            </Animated.View>
                        ))
                    )}
                </Animated.View>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingBottom: 12,
        gap: 12,
    },
    headerBtn: {
        width: 36, height: 36, borderRadius: 18,
        alignItems: 'center', justifyContent: 'center',
    },
    headerTitle: {
        flex: 1, fontSize: 17, fontFamily: 'Inter_600SemiBold',
    },
    saveBtn: {
        paddingHorizontal: 16, paddingVertical: 8,
        borderRadius: 20, minWidth: 60, alignItems: 'center',
    },
    saveBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },
    scrollContent: { paddingHorizontal: 16, gap: 20, paddingTop: 8 },
    sectionLabel: {
        fontSize: 12, fontFamily: 'Inter_600SemiBold',
        textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8,
    },
    sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
    card: {
        borderRadius: 16, borderWidth: 1,
        padding: 16, gap: 14,
    },
    inputGroup: { gap: 5 },
    label: { fontSize: 12, fontFamily: 'Inter_500Medium' },
    inputWrapper: {
        flexDirection: 'row', alignItems: 'center',
        gap: 10, paddingHorizontal: 12, paddingVertical: 11,
        borderRadius: 10, borderWidth: 1,
    },
    input: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular' },
    addBtn: {
        flexDirection: 'row', alignItems: 'center',
        gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
    },
    addBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
    emptyMed: {
        borderRadius: 16, borderWidth: 1, padding: 24,
        alignItems: 'center', gap: 8,
    },
    emptyMedText: { fontSize: 14, fontFamily: 'Inter_500Medium' },
    emptyMedSub: { fontSize: 12, fontFamily: 'Inter_400Regular', textAlign: 'center' },
    medCard: {
        borderRadius: 14, borderWidth: 1, padding: 14, gap: 10,
    },
    medCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    medNum: { fontSize: 12, fontFamily: 'Inter_600SemiBold', textTransform: 'uppercase', letterSpacing: 0.5 },
    medInput: {
        borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10,
        fontSize: 14, fontFamily: 'Inter_400Regular',
    },
    medRow: { flexDirection: 'row', gap: 10 },
    medInputHalf: {
        flex: 1, borderRadius: 10, borderWidth: 1,
        paddingHorizontal: 12, paddingVertical: 10,
        fontSize: 13, fontFamily: 'Inter_400Regular',
    },
});
