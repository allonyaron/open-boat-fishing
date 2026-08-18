import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { API_URL } from "@/lib/api";
import { useMateAuth } from "@/lib/mate-auth-context";
import { Colors } from "@/constants/Colors";

type FishCount = { species: string; count: number };

type Report = {
  id: string;
  catchSummary: string | null;
  fishCounts: FishCount[];
  photoUrls: string[];
};

export default function TripReportScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const { token } = useMateAuth();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [existing, setExisting] = useState<Report | null>(null);

  const [catchSummary, setCatchSummary] = useState("");
  const [fishCounts, setFishCounts] = useState<FishCount[]>([]);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const speciesInputRef = useRef<TextInput[]>([]);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/api/mate/trips/${tripId}/report`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const r = (await res.json()) as Report;
        setExisting(r);
        setCatchSummary(r.catchSummary ?? "");
        setFishCounts(r.fishCounts ?? []);
        setPhotoUrls(r.photoUrls ?? []);
      }
    } catch {
      // Network issue — start with empty form
    }
    setLoading(false);
  }, [token, tripId]);

  useEffect(() => {
    load();
  }, [load]);

  async function pickPhoto() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow photo library access to attach trip photos.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      quality: 0.8,
      exif: false,
    });
    if (result.canceled || result.assets.length === 0) return;

    setUploadingPhoto(true);
    try {
      const uploaded = await Promise.all(
        result.assets.map(async (asset) => {
          const filename = asset.fileName ?? `photo-${Date.now()}.jpg`;
          const mime = asset.mimeType ?? "image/jpeg";
          const res = await fetch(`${API_URL}/api/reports/upload-photo`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": mime,
              "X-Filename": filename,
            },
            body: await fetch(asset.uri).then((r) => r.blob()),
          });
          if (!res.ok) throw new Error("Upload failed");
          const { url } = (await res.json()) as { url: string };
          return url;
        }),
      );
      setPhotoUrls((prev) => [...prev, ...uploaded]);
    } catch {
      Alert.alert("Upload failed", "Could not upload one or more photos. Check your connection.");
    }
    setUploadingPhoto(false);
  }

  async function save() {
    if (!token) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/mate/trips/${tripId}/report`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          catchSummary: catchSummary.trim() || undefined,
          fishCounts: fishCounts.filter((fc) => fc.species.trim().length > 0),
          photoUrls,
        }),
      });
      if (res.ok) {
        const saved = (await res.json()) as Report;
        setExisting(saved);
        Alert.alert("Saved", "Fishing report posted.", [
          { text: "OK", onPress: () => router.back() },
        ]);
      } else {
        const body = (await res.json()) as { error?: string };
        Alert.alert("Error", body.error ?? "Failed to save report.");
      }
    } catch {
      Alert.alert("Error", "No connection. Try again when online.");
    }
    setSaving(false);
  }

  function addFishCount() {
    setFishCounts((prev) => [...prev, { species: "", count: 0 }]);
  }

  function updateFishCount(index: number, field: keyof FishCount, value: string | number) {
    setFishCounts((prev) => prev.map((fc, i) => (i === index ? { ...fc, [field]: value } : fc)));
  }

  function removeFishCount(index: number) {
    setFishCounts((prev) => prev.filter((_, i) => i !== index));
  }

  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.centered}>
          <ActivityIndicator size="large" color={Colors.teal} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Header */}
        <View style={s.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={s.back}>← Back</Text>
          </TouchableOpacity>
          <Text style={s.title}>{existing ? "Edit Report" : "Post Report"}</Text>
          <View style={{ width: 60 }} />
        </View>

        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.content}
          keyboardShouldPersistTaps="handled"
        >
          {/* Catch Summary */}
          <Text style={s.label}>Catch Summary</Text>
          <TextInput
            style={s.textarea}
            value={catchSummary}
            onChangeText={setCatchSummary}
            placeholder="Describe today's catch…"
            placeholderTextColor={Colors.inkSubtle}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />

          {/* Fish Counts */}
          <View style={s.sectionHeader}>
            <Text style={s.label}>Fish Counts</Text>
            <TouchableOpacity onPress={addFishCount}>
              <Text style={s.addLink}>+ Add species</Text>
            </TouchableOpacity>
          </View>

          {fishCounts.length === 0 && <Text style={s.emptyHint}>No fish counts added</Text>}

          {fishCounts.map((fc, i) => (
            <View key={i} style={s.fishRow}>
              <TextInput
                ref={(el) => {
                  if (el) speciesInputRef.current[i] = el;
                }}
                style={[s.input, s.speciesInput]}
                value={fc.species}
                onChangeText={(v) => updateFishCount(i, "species", v)}
                placeholder="Species"
                placeholderTextColor={Colors.inkSubtle}
                returnKeyType="next"
              />
              <TextInput
                style={[s.input, s.countInput]}
                value={fc.count === 0 ? "" : String(fc.count)}
                onChangeText={(v) => updateFishCount(i, "count", parseInt(v, 10) || 0)}
                placeholder="0"
                placeholderTextColor={Colors.inkSubtle}
                keyboardType="number-pad"
              />
              <TouchableOpacity
                onPress={() => removeFishCount(i)}
                style={s.removeBtn}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={s.removeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
          ))}

          {/* Photos */}
          <View style={s.sectionHeader}>
            <Text style={s.label}>Photos</Text>
            <TouchableOpacity onPress={pickPhoto} disabled={uploadingPhoto}>
              <Text style={[s.addLink, uploadingPhoto && s.disabled]}>
                {uploadingPhoto ? "Uploading…" : "+ Add photos"}
              </Text>
            </TouchableOpacity>
          </View>

          {photoUrls.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.photoScroll}>
              {photoUrls.map((url, i) => (
                <View key={i} style={s.photoWrapper}>
                  <Image source={{ uri: url }} style={s.photo} />
                  <Pressable
                    style={s.removePhoto}
                    onPress={() => setPhotoUrls((prev) => prev.filter((_, idx) => idx !== i))}
                  >
                    <Text style={s.removePhotoText}>✕</Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          )}

          {/* Save Button */}
          <TouchableOpacity
            style={[s.saveBtn, (saving || uploadingPhoto) && s.saveBtnDisabled]}
            onPress={save}
            disabled={saving || uploadingPhoto}
          >
            {saving ? (
              <ActivityIndicator color={Colors.white} />
            ) : (
              <Text style={s.saveBtnText}>{existing ? "Update Report" : "Post Report"}</Text>
            )}
          </TouchableOpacity>

          <View style={{ height: 32 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surfaceAlt },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Colors.teal,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  back: { color: Colors.white, fontSize: 15, fontWeight: "600", width: 60 },
  title: { color: Colors.white, fontSize: 18, fontWeight: "700" },
  scroll: { flex: 1 },
  content: { padding: 16, gap: 4 },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.inkSubtle,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 16,
    marginBottom: 8,
  },
  textarea: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    color: Colors.ink,
    minHeight: 100,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 16,
    marginBottom: 8,
  },
  addLink: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.teal,
  },
  disabled: { opacity: 0.4 },
  emptyHint: {
    fontSize: 14,
    color: Colors.inkSubtle,
    fontStyle: "italic",
  },
  fishRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  input: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
    color: Colors.ink,
  },
  speciesInput: { flex: 1 },
  countInput: { width: 64, textAlign: "center" },
  removeBtn: { padding: 4 },
  removeBtnText: { color: Colors.error, fontSize: 16 },
  photoScroll: { marginBottom: 8 },
  photoWrapper: {
    position: "relative",
    marginRight: 8,
  },
  photo: {
    width: 90,
    height: 90,
    borderRadius: 8,
    backgroundColor: Colors.border,
  },
  removePhoto: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Colors.error,
    alignItems: "center",
    justifyContent: "center",
  },
  removePhotoText: { color: Colors.white, fontSize: 11, fontWeight: "700" },
  saveBtn: {
    backgroundColor: Colors.teal,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 24,
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: {
    color: Colors.white,
    fontSize: 16,
    fontWeight: "700",
  },
});
