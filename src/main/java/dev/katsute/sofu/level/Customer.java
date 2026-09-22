/*
 * Copyright (C) 2026 Katsute <https://github.com/Katsute>
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with this program; if not, write to the Free Software Foundation, Inc.,
 * 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA.
 */

package dev.katsute.sofu.level;

import java.util.Arrays;
import java.util.stream.Collectors;

public class Customer extends Entity {

    public Customer(final String name, final int index, final float gratuity, final int wait){
        super("customer");
        this.props.put("name", name);
        this.props.put("index", String.valueOf(index));
        this.props.put("gratuity_percent", String.valueOf(gratuity));
        this.props.put("wait", String.valueOf(wait));
    }

    public Customer(final String name, final int index, final int gratuity, final int wait){
        super("customer");
        this.props.put("name", name);
        this.props.put("index", String.valueOf(index));
        this.props.put("gratuity", String.valueOf(gratuity));
        this.props.put("wait", String.valueOf(wait));
    }

    public class Group extends Entity {

        public Group(final int[] customers){
            super("group");
            this.props.put("customers", Arrays.stream(customers)
                      .mapToObj(String::valueOf)
                      .collect(Collectors.joining(",")));
        }

    }

}
