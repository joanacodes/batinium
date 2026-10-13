import { supabase } from './supabase';
import type { Alerte } from './alertes';
import { codeFluide, frequence, listerFluides, moisFrequence, tonnage } from './machines';

/**
 * Les alertes du registre des machines et des fiches fluides.
 *
 * Elles vivent à part d'`alertes.ts` pour la même raison que les modules
 * qu'elles lisent : la phase 1 a été écrite sans la version courante de ce
 * fichier. `calculerAlertes()` n'a qu'à les ajouter aux siennes.
 *
 * Chacune mène à l'écran où l'on agit : une alerte sans lien n'est qu'un
 * reproche.
 */

const JOUR = 86400000;
const jour = (d: Date | string) => new Date(d).toISOString().slice(0, 10);
const ilYa = (n: number) => jour(new Date(Date.now() - n * JOUR));
const dans = (n: number) => jour(new Date(Date.now() + n * JOUR));

interface MachineLue {
  id: string; chantier_id: string | null; numero_serie: string | null;
  mise_en_service_le: string | null; fluide: string | null; charge_kg: number | null;
  prp: number | null; hermetique: boolean; detection_permanente: boolean;
  marque: string | null; modele: string | null; piece: string | null; statut: string;
}

export async function alertesFluides(): Promise<Alerte[]> {
  const a: Alerte[] = [];

  const [machines, poses, fiches, fluides] = await Promise.all([
    supabase.from('equipement')
      .select('id, chantier_id, numero_serie, mise_en_service_le, fluide, charge_kg, prp, hermetique, detection_permanente, marque, modele, piece, statut')
      .eq('statut', 'actif').then((r) => (r.data ?? []) as MachineLue[]),
    supabase.from('intervention').select('chantier_id, fin_le, date_prevue')
      .eq('type', 'pose').eq('statut', 'terminee')
      .then((r) => (r.data ?? []) as { chantier_id: string | null; fin_le: string | null; date_prevue: string | null }[]),
    supabase.from('fiche_fluide')
      .select('id, numero, statut, equipement_id, intervention_id, chantier_id, nature, created_at, signature_operateur_le, date_intervention, detenteur')
      .neq('statut', 'rectifiee')
      .then((r) => (r.data ?? []) as {
        id: string; numero: string | null; statut: string; equipement_id: string;
        intervention_id: string | null; chantier_id: string | null; nature: string[];
        created_at: string; signature_operateur_le: string | null; date_intervention: string;
        detenteur: { nom?: string | null } | null;
      }[]),
    listerFluides().catch(() => []),
  ]);
  const familleDe = new Map(fluides.map((f) => [f.code, f.famille]));

  const nomMachine = (m: MachineLue) =>
    ([m.marque, m.modele].filter(Boolean).join(' ') || 'Machine')
    + (m.piece ? ` (${m.piece})` : '');

  // 1. Machine posée, numéro de série toujours pas relevé. Une semaine de
  //    grâce : le relevé se fait souvent à la mise en service, pas à la pose.
  const poseeLe = new Map<string, string>();
  for (const p of poses) {
    const d = p.fin_le ?? p.date_prevue;
    if (p.chantier_id && d && (!poseeLe.has(p.chantier_id) || d > poseeLe.get(p.chantier_id)!)) {
      poseeLe.set(p.chantier_id, d);
    }
  }
  for (const m of machines) {
    if (m.numero_serie) continue;
    const depuis = m.mise_en_service_le ?? (m.chantier_id ? poseeLe.get(m.chantier_id) : undefined);
    if (!depuis || jour(depuis) > ilYa(7)) continue;
    a.push({
      cle: `machine:releve:${m.id}`, gravite: 'attention',
      titre: `${nomMachine(m)} : numéro de série à relever`,
      detail: 'Posée depuis plus d’une semaine. Sans lui, pas de fiche Cerfa ni de garantie traçable.',
      lien: m.chantier_id ? `#/chantiers/${m.chantier_id}` : undefined, date: depuis,
    });
  }

  // 2. Fiche signée par le technicien, client toujours absent. Seules les
  //    fiches qui exigent sa signature restent dans cet état : sous 3 kg de
  //    HCFC ou 5 t éq. CO2 de HFC, la base les clôt dès le technicien.
  for (const f of fiches) {
    if (f.statut !== 'signee_operateur' || !f.signature_operateur_le) continue;
    if (jour(f.signature_operateur_le) > ilYa(7)) continue;
    a.push({
      cle: `fiche:client:${f.id}`, gravite: 'attention',
      titre: `Fiche ${f.numero} : signature du client manquante`,
      detail: f.detenteur?.nom ? `Client : ${f.detenteur.nom}.` : undefined,
      lien: `#/fluide/${f.id}`, date: f.signature_operateur_le,
    });
  }

  // 3. Brouillon resté sur une intervention terminée. Une intervention sur le
  //    fluide sans fiche est une infraction, pas un oubli administratif.
  const brouillons = fiches.filter((f) => f.statut === 'brouillon' && f.intervention_id
    && jour(f.created_at) <= ilYa(2));
  if (brouillons.length) {
    const { data } = await supabase.from('intervention').select('id, statut')
      .in('id', brouillons.map((f) => f.intervention_id!));
    const terminees = new Set((data ?? []).filter((i) => i.statut === 'terminee').map((i) => i.id));
    for (const f of brouillons) {
      if (!terminees.has(f.intervention_id!)) continue;
      a.push({
        cle: `fiche:brouillon:${f.id}`, gravite: 'attention',
        titre: 'Fiche fluides non signée après une intervention terminée',
        detail: 'Toute intervention sur le fluide exige sa fiche signée. Elle est en brouillon depuis plus de deux jours.',
        lien: `#/fluide/${f.id}`, date: f.created_at,
      });
    }
  }

  // 4. Contrôle d'étanchéité à échéance, pour les machines qui y sont soumises.
  //    Point de départ : le dernier contrôle signé, à défaut la mise en service.
  const dernierControle = new Map<string, string>();
  for (const f of fiches) {
    if (f.statut === 'brouillon') continue;
    if (!f.nature.some((n) => n === 'controle_periodique' || n === 'controle_non_periodique')) continue;
    const d = dernierControle.get(f.equipement_id);
    if (!d || f.date_intervention > d) dernierControle.set(f.equipement_id, f.date_intervention);
  }
  for (const m of machines) {
    const famille = familleDe.get(codeFluide(m.fluide) ?? '');
    const mois = moisFrequence(frequence(famille, m.charge_kg, tonnage(m.charge_kg, m.prp),
                                         m.hermetique, m.detection_permanente));
    if (!mois) continue;
    const depart = dernierControle.get(m.id) ?? m.mise_en_service_le;
    if (!depart) continue;
    const echeance = new Date(depart);
    echeance.setMonth(echeance.getMonth() + mois);
    const e = jour(echeance);
    if (e > dans(30)) continue;
    const depassee = e < jour(new Date());
    a.push({
      cle: `machine:etancheite:${m.id}:${e}`, gravite: depassee ? 'urgent' : 'attention',
      titre: `${nomMachine(m)} : contrôle d’étanchéité ${depassee ? 'en retard' : 'à prévoir'}`,
      detail: `Échéance le ${new Date(e).toLocaleDateString('fr-FR')} (tous les ${mois} mois). C’est une obligation réglementaire.`,
      lien: m.chantier_id ? `#/chantiers/${m.chantier_id}` : undefined, date: e,
    });
  }

  return a;
}
