// FoodX — supplier data service.
import { supabase } from '@/lib/supabase'
import type { Supplier } from '@/types'

export async function fetchSuppliers(
  restaurantId: string,
): Promise<Supplier[]> {
  const { data, error } = await supabase
    .from('suppliers')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as Supplier[]
}

export async function createSupplier(
  restaurantId: string,
  values: {
    name: string
    phone?: string
    email?: string
    address?: string
  },
): Promise<Supplier> {
  const { data, error } = await supabase
    .from('suppliers')
    .insert({
      id: crypto.randomUUID(),
      restaurant_id: restaurantId,
      name: values.name.trim(),
      phone: values.phone?.trim() || null,
      email: values.email?.trim() || null,
      address: values.address?.trim() || null,
    })
    .select()
    .single()
  if (error) throw error
  return data as Supplier
}

export async function updateSupplier(
  supplierId: string,
  patch: Partial<
    Pick<Supplier, 'name' | 'phone' | 'email' | 'address' | 'is_active'>
  >,
): Promise<Supplier> {
  const { data, error } = await supabase
    .from('suppliers')
    .update(patch)
    .eq('id', supplierId)
    .select()
    .single()
  if (error) throw error
  return data as Supplier
}

export async function deleteSupplier(supplierId: string): Promise<void> {
  // Purchase orders reference their supplier with ON DELETE RESTRICT,
  // so a supplier with any purchase order cannot be deleted.
  const { error } = await supabase
    .from('suppliers')
    .delete()
    .eq('id', supplierId)
  if (error) throw error
}
