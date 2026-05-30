import React from 'react';
import {
  Modal, View, Text, StyleSheet, Pressable, ScrollView, Linking, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeColors } from '@/constants/colors';
import { useEffectiveColorScheme } from '@/lib/settings-context';

const PRIVACY_URL = 'https://domynote.com/privacy';

interface AIConsentModalProps {
  visible: boolean;
  onAgree: () => void;
  onDecline: () => void;
}

export default function AIConsentModal({ visible, onAgree, onDecline }: AIConsentModalProps) {
  const colorScheme = useEffectiveColorScheme();
  const colors = useThemeColors(colorScheme);
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onDecline}>
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + 12 }]}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.iconWrap, { backgroundColor: colors.tintLight }]}>
            <Ionicons name="shield-checkmark" size={32} color={colors.tint} />
          </View>

          <Text style={[styles.title, { color: colors.text }]}>AI Data Processing Consent</Text>
          <Text style={[styles.lead, { color: colors.textSecondary }]}>
            Before DoMyNote sends any clinical data for AI processing, we need your permission.
          </Text>

          <Section title="What data may be sent" colors={colors}>
            <Bullet colors={colors}>Clinical questions you type in Consult</Bullet>
            <Bullet colors={colors}>Audio recordings from patient encounters</Bullet>
            <Bullet colors={colors}>Photos of documents, insurance cards, or lab results</Bullet>
            <Bullet colors={colors}>Transcripts and note content used to generate SOAP notes</Bullet>
            <Bullet colors={colors}>Your account email and name (for authentication only)</Bullet>
          </Section>

          <Section title="Who receives this data" colors={colors}>
            <Bullet colors={colors}>Supabase (secure cloud hosting &amp; authentication)</Bullet>
            <Bullet colors={colors}>AWS HealthScribe (medical speech-to-text transcription)</Bullet>
            <Bullet colors={colors}>OpenAI (clinical note generation &amp; consult responses)</Bullet>
          </Section>

          <Section title="How data is protected" colors={colors}>
            <Bullet colors={colors}>Encrypted in transit (TLS) and at rest</Bullet>
            <Bullet colors={colors}>Used only to provide features you request</Bullet>
            <Bullet colors={colors}>Not sold or used for advertising</Bullet>
            <Bullet colors={colors}>Not used to track you across other apps or websites</Bullet>
          </Section>

          <Pressable onPress={() => Linking.openURL(PRIVACY_URL).catch(() => {})}>
            <Text style={[styles.link, { color: colors.tint }]}>Read full Privacy Policy</Text>
          </Pressable>
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16), backgroundColor: colors.background, borderTopColor: colors.border }]}>
          <Pressable
            onPress={onDecline}
            style={({ pressed }) => [styles.secondaryBtn, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={[styles.secondaryText, { color: colors.textSecondary }]}>Not Now</Text>
          </Pressable>
          <Pressable
            onPress={onAgree}
            style={({ pressed }) => [styles.primaryBtn, { backgroundColor: colors.tint, opacity: pressed ? 0.9 : 1 }]}
          >
            <Text style={styles.primaryText}>I Agree — Enable AI Features</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function Section({ title, colors, children }: { title: string; colors: ReturnType<typeof useThemeColors>; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>{title}</Text>
      {children}
    </View>
  );
}

function Bullet({ colors, children }: { colors: ReturnType<typeof useThemeColors>; children: React.ReactNode }) {
  return (
    <View style={styles.bulletRow}>
      <Text style={[styles.bullet, { color: colors.tint }]}>•</Text>
      <Text style={[styles.bulletText, { color: colors.textSecondary }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 24, paddingTop: 8, gap: 16 },
  iconWrap: {
    width: 64, height: 64, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center', alignSelf: 'center',
  },
  title: { fontSize: 22, fontFamily: 'Inter_700Bold', textAlign: 'center' },
  lead: { fontSize: 15, fontFamily: 'Inter_400Regular', lineHeight: 22, textAlign: 'center' },
  section: { gap: 8, marginTop: 4 },
  sectionTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  bulletRow: { flexDirection: 'row', gap: 8, paddingRight: 8 },
  bullet: { fontSize: 16, lineHeight: 22 },
  bulletText: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 21 },
  link: { fontSize: 14, fontFamily: 'Inter_500Medium', textAlign: 'center', marginTop: 8 },
  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: 20, paddingTop: 12, gap: 10, borderTopWidth: StyleSheet.hairlineWidth,
  },
  primaryBtn: { paddingVertical: 16, borderRadius: 14, alignItems: 'center' },
  primaryText: { color: '#fff', fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  secondaryBtn: { paddingVertical: 14, borderRadius: 14, alignItems: 'center', borderWidth: 1 },
  secondaryText: { fontSize: 15, fontFamily: 'Inter_500Medium' },
});
